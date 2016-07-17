/* jshint esversion: 6, asi: true */


const {Transform} = require('stream');

function ThrottleStream(time) {
  const str = new Transform({
    objectMode: true,
    highWaterMark: 5,
    transform(chunk, encoding, callback) {
      if (this.last + time < Date.now()) {
        this.last = Date.now();
        callback(null, chunk);
      } else {
        setTimeout(() => {
          this.last = Date.now();
          callback(null, chunk);
        }, this.last + time - Date.now());
      }
    }
  });
  str.last = 0;
  return str;
}


function FnTransform(fn) {
	return new Transform({
		objectMode: true,
		transform(chunk, encoding, callback) {
			return callback(null, fn(chunk));
		}
	})
}

Object.assign(module.exports, {ThrottleStream, FnTransform})
