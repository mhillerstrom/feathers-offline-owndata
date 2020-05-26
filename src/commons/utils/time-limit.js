const CAF = require('caf');

/**
 * Limit execution time for a async function
 * @param {function} fn Async function to limit
 * @param {number} limit Number of milliseconds to allow execution to proceed (default 5000 ms = 5 sec)
 * @return [ err, res ]
 */
const timeLimit = function (fn, ctx, limit = 5000) {
  return function (...args) {
    const limitedFn = CAF(function * (signal, ...args) {
      yield fn.call(ctx, ...args)
        .then(res => { timeoutToken.abort({ _ok: true, res: res }); })
        .catch(err => { timeoutToken.abort({ _ok: false, err: err }); });
    });

    const timeoutToken = CAF.timeout(limit, 'Timeout');

    return limitedFn(timeoutToken, ...args)
      .then(res => [null, res])
      .catch(err => {
        if (err === 'Timeout') { return [{ timeout: true, args, limit }, null]; }

        const ok = err._ok;
        delete err._ok;
        if (ok) { return [null, Object.assign({}, err, { limit })]; } else { return [Object.assign({}, err, { limit }), null]; }
      });
  };
};

module.exports = { timeLimit };
