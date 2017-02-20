/* jshint esversion: 6, asi: true */

const OVApi = require("OVApi").default;

const {Transform, Readable} = require('stream');


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
			this.continuation()
			.then(({records, continuation}) => {
				let should_continue = false
				records.forEach((data) => should_continue = this.push(data))
				this.continuation = continuation
				this.working = false
				if (records.some((e) => e.transactionDateTime < start)) {
					this.push(null);
				} else if(should_continue) {
					this._read()
				}
			})
			.catch(err => {
				this.emit('error', err)
			})
		}
	});
	myReadable.continuation = () => api.getTransactionsNRC(mediumId)
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
