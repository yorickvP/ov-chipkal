/* jshint esversion: 6, asi: true */

const OVApi = require("OVApi").default;

const {Transform, Readable} = require('stream');

const normalize_time = (t) => new Date((t / 1000 | 0) * 1000)
const normalize_times = (data) => Object.assign(data, {
	transactionDateTime: normalize_time(data.transactionDateTime)
})



function get_event_stream({username, password}, startDate, group_checkins, cb) {
	const ov = new OVApi(username, password)
	ov.authorize().then(() => ov.getCards()).then(cards => {
		let transl = get_transaction_list(ov, cards[0].mediumId, startDate)
		if (group_checkins) transl = transl.pipe(group_checkin_checkout())
		return transl
	}).then(cb)
}
module.exports = get_event_stream

/** get_transaction_list: gets transactions from the OV-chipkaart API
  *
  * start: don't request transactions before this start-date. You might still get some.
  */
function get_transaction_list(api, mediumId, start = null) {
	const myReadable = new Readable({
		objectMode: true,
		read(size) {
			if (this.working) return;
			this.working = true;
			api._tlsRequest("transactions", Object.assign({
				locale: "nl-NL", mediumId
			}, this.nextRequestContext))
			.then(({records, nextRequestContext}) => {
				let contRead = false
				records.forEach((data) => contRead = this.push(normalize_times(data)))
				this.working = false;
				this.nextRequestContext = nextRequestContext
				if (records.some((e) => normalize_time(e.transactionDateTime) < start)) {
					this.push(null);
				} else if(contRead) {
					this._read()
				}
			})
			.catch(err => {
				this.emit('error', err)
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
