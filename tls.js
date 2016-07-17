/* jshint esversion: 6, asi: true */


const client_id     = "nmOIiEJO5khvtLBK9xad3UkkS8Ua"
const client_secret = "FE8ef6bVBiyN0NeyUJ5VOWdelvQa"

const oauthurl = "https://login.ov-chipkaart.nl/oauth2/token"
const tlsurl = "https://api2.ov-chipkaart.nl/femobilegateway/v1"

const request = require('request')
const {Transform, Readable} = require('stream');
const {FnTransform} = require('./streamutil')

function postoauth(form, cb) {
	request.post(oauthurl, {form}, function(err, httpr, body) {
		if (!err && httpr.statusCode == 200) {
			cb(null, JSON.parse(body))
		} else {
			cb([err, body])
		}
	});
}
function get_token(username, password, cb) {
	const form = {
		username, password,
		grant_type: "password",
		client_id, client_secret,
		scope: "openid"
	};
	postoauth(form, cb);
}

function refresh_token(refresh_token) {
	const form = {
		refresh_token,
		grant_type: "refresh_token",
		client_id, client_secret,
	}
	postoauth(form, cb);
}

const normalize_time = (t) => new Date((t / 1000 | 0) * 1000)
const normalize_times = (data) => Object.assign(data, {
	transactionDateTime: normalize_time(data.transactionDateTime)
})


function get_event_stream({username, password}, startDate, group_checkins, cb) {
	get_token(username, password, (err, res) => {
		authorize(res.id_token, (err, auth) => {
			get_cards_list(auth, (err, cards) => {
				let transl = get_transaction_list(auth, cards[0].mediumId, startDate)
				if (group_checkins) transl = transl.pipe(group_checkin_checkout())
					cb(transl, cards[0])
			})
		})
	})
}
module.exports = get_event_stream

function tlsreq(call, form, cb) {
	request.post(`${tlsurl}/${call}`, {form, 
		//headers: {"User-Agent": "Android"}
	}, function(err, httpr, body) {
		if (!err && httpr.statusCode == 200) {
			const {c,o,e} = JSON.parse(body)
			if (c != 200) cb("got error code", {c, o, e})
				else cb(null, o)
			} else cb(err, body)
	})
}

function authorize(id_token, cb) {
	tlsreq('api/authorize', {authenticationToken: id_token}, cb)
}
function get_cards_list(auth, cb) {
	tlsreq('cards/list', {
		authorizationToken: auth,
		locale: "nl-NL"
	}, cb)
}

/** get_transaction_list: gets transactions from the OV-chipkaart API
  *
  * start: don't request transactions before this start-date. You might still get some.
  */
function get_transaction_list(auth, mediumId, start = null) {
	const myReadable = new Readable({
		objectMode: true,
		read(size) {
			if (this.working) return;
			this.working = true;
			tlsreq("transactions", Object.assign({
				authorizationToken: auth, locale: "nl-NL", mediumId
			}, this.nextRequestContext), (err, o) => {
				if (err) this.emit("error", err)
					let contRead = false
				o.records.forEach((data) => contRead = this.push(normalize_times(data)))
				this.working = false;
				this.nextRequestContext = o.nextRequestContext
				if (o.records.some((e) => normalize_time(e.transactionDateTime) < start)) {
					this.push(null);
				} else if(contRead) {
					this._read()
				}
			})
		}
	});
	myReadable.nextRequestContext = {};
	return myReadable;
}


function group_checkin_checkout() {
	return new Transform({
		objectMode: true,
		transform(chunk, encoding, callback) {
			if (chunk.transactionName == "Check-uit") {
				this._flush();
				this.current_checkout = chunk
			} else if (chunk.transactionName == "Check-in") {
				if (!this.current_checkout || this.current_checkout.checkInInfo != chunk.transactionInfo) {
					this._flush();
					this.push({type: "unmatched_in", checkin: chunk});
				} else {
					this.push({type: "full_travel", checkin: chunk, checkout: this.current_checkout});
					this.current_checkout = null;
				}
			} else {
				this.push({type: 'other', data: chunk})
			}
			callback();
		},
		flush() {
			if (this.current_checkout) {
				this.push({type: "unmatched_out", checkout: this.current_checkout});
				this.current_checkout = null
			}
		}
	})
}
