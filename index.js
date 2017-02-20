/* jshint esversion: 6, asi: true */

const {ThrottleStream, FnTransform} = require('./streamutil')
const gcal = require('./gcal.js');
const fs = require('fs')


function toGoogleCalendarEvent({type, checkin, checkout}) {
    if (type != "full_travel") return; // TODO: warn
    return {
        id: "" + (+checkin.transactionDateTime),
        location: checkin.transactionInfo,
        start: {
            dateTime: checkin.transactionDateTime,
        },
        end: {
            dateTime: checkout.transactionDateTime,
        },
        summary: `${checkin.modalType} ${checkout.transactionInfo} vanaf ${checkin.transactionInfo}`,
        description: checkout.productInfo + (checkout.fare ? "\nKosten: €" + checkout.fare : ''),
    };
}

const settings = require('./settings.json')

gcal((calendar, auth) => {
    const tls_stream = require("./tls.js");
    let mtime;
    try {
        mtime = fs.statSync("LAST_RUN").mtime
    } catch(e) {
        if (e.code != 'ENOENT') throw e;
        mtime = new Date(2016, 0);
    }
    fs.utimesSync("LAST_RUN", Infinity, Infinity); // touch this file now
    console.log("downloading up to", mtime)
    tls_stream(settings.tls, mtime, true, (str) => {
        str.pipe(FnTransform(toGoogleCalendarEvent))
           .pipe(ThrottleStream(300)).on('data', (calevent) => {
            calendar.events.insert({
                auth,
                eventId: calevent.id,
                calendarId: settings.calendarId,
                resource: calevent
            }, (err, event) => {
                if (err) {
                    console.log('Error making event: ' + err);
                    return;
                }
                console.log('Event created: %s', event.htmlLink);
            })
        });
    });
})