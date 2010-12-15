/*!
 * benchmark.js
 * Copyright Mathias Bynens <http://mths.be/>
 * Based on JSLitmus.js, copyright Robert Kieffer <http://broofa.com/>
 * Modified by John-David Dalton <http://allyoucanleet.com/>
 * Available under MIT license <http://mths.be/mit>
 */

(function(window) {

  /** Feature detect function decompilation via toString() (performed in embed) */
  var HAS_FUNC_DECOMP,

  /** Feature detect DOM0 timeout API (performed at the bottom) */
  HAS_TIMEOUT_API,

  /** Integrity check for compiled tests */
  EMBEDDED_UID = +new Date,

  /** Divisors used to avoid hz of Infinity */
  CYCLE_DIVISORS = {
    '1': 4096,
    '2': 512,
    '3': 64,
    '4': 8,
    '5': 0
  },

  /**
   * T-Distribution critical values for 95% confidence
   * http://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
   */
  T_DISTRIBUTION = {
    '1':  12.706,'2':  4.303, '3':  3.182, '4':  2.776, '5':  2.571, '6':  2.447,
    '7':  2.365, '8':  2.306, '9':  2.262, '10': 2.228, '11': 2.201, '12': 2.179,
    '13': 2.160, '14': 2.145, '15': 2.131, '16': 2.120, '17': 2.110, '18': 2.101,
    '19': 2.093, '20': 2.086, '21': 2.080, '22': 2.074, '23': 2.069, '24': 2.064,
    '25': 2.060, '26': 2.056, '27': 2.052, '28': 2.048, '29': 2.045, '30': 2.042,
    '31': 2.040, '32': 2.037, '33': 2.035, '34': 2.032, '35': 2.030, '36': 2.028,
    '37': 2.026, '38': 2.024, '39': 2.023, '40': 2.021, '41': 2.020, '42': 2.018,
    '43': 2.017, '44': 2.015, '45': 2.014, '46': 2.013, '47': 2.012, '48': 2.011,
    '49': 2.010, '50': 2.009, '51': 2.008, '52': 2.007, '53': 2.006, '54': 2.005,
    '55': 2.004, '56': 2.003, '57': 2.002, '58': 2.002, '59': 2.001, '60': 2.000,
    '61': 2.000, '62': 1.999, '63': 1.998, '64': 1.998, '65': 1.997, '66': 1.997,
    '67': 1.996, '68': 1.995, '69': 1.995, '70': 1.994, '71': 1.994, '72': 1.993,
    '73': 1.993, '74': 1.993, '75': 1.992, '76': 1.992, '77': 1.991, '78': 1.991,
    '79': 1.990, '80': 1.990, '81': 1.990, '82': 1.989, '83': 1.989, '84': 1.989,
    '85': 1.988, '86': 1.988, '87': 1.988, '88': 1.987, '89': 1.987, '90': 1.987,
    '91': 1.986, '92': 1.986, '93': 1.986, '94': 1.986, '95': 1.985, '96': 1.985,
    '97': 1.985, '98': 1.984, '99': 1.984, '100': 1.984,'Infinity': 1.960
  },

  /** Internal cached used by various methods */
  cache = {
    'compiled': { },
    'counter': 0
  },

  /** Used in Benchmark.hasKey() */
  hasOwnProperty = cache.hasOwnProperty,

  /** Used to convert array-like objects to arrays */
  slice = [].slice,

  /** Smallest measurable time (secs) */
  timerMin = null,

  /** Root namespace for timer API (defined later) */
  timerNS = null,

  /** Resolution of the timer (ms, us, or ns) */
  timerRes = 'ms';

  /*--------------------------------------------------------------------------*/

  /**
   * Benchmark constructor.
   * @constructor
   * @param {Function} fn The test to benchmark.
   * @param {Object} [options={}] Options object.
   */
  function Benchmark(fn, options) {
    var me = this;
    fn.uid || (fn.uid = ++cache.counter);
    options = extend({ }, options);

    forIn(options, function(value, key) {
      // add event listeners
      if (/^on[A-Z]/.test(key)) {
        me.on(key.slice(2).toLowerCase(), value);
      } else {
        me[key] = value;
      }
    });

    me.fn = fn;
    me.options = options;
    me.times = extend({ }, me.times);
  }

  /**
   * Subclass of Benchmark used specifically for calibration.
   * @private
   * @constructor
   * @base Benchmark
   * @param {Function} fn The test to benchmark.
   * @param {Object} [options={}] Options object.
   */
  function Calibration(fn, options) {
    Benchmark.call(this, fn, options);
  }

  // Calibration inherits from Benchmark
  (function() {
    function Klass() { }
    Klass.prototype = Benchmark.prototype;
    (Calibration.prototype = new Klass).constructor = Calibration;
  }());

  /*--------------------------------------------------------------------------*/

  /**
   * Runs calibration benchmarks, if needed, and fires a callback when completed.
   * @private
   * @param {Object} me The benchmark instance waiting for calibrations to complete.
   * @param {Function} callback Function executed after calibration.
   * @param {Boolean} [async=false] Flag to run asynchronously.
   * @returns {Boolean} Returns true if calibrated, else false.
   */
  function calibrate(me, callback, async) {
    var result = isCalibrated(),
        onCycle = function(cal) { return !(cal.aborted || me.aborted); };

    // calibrate all if one has not ran
    if (!result) {
      invoke(Benchmark.CALIBRATIONS, {
        'async': async,
        'methodName': 'run',
        'onCycle': onCycle,
        'onComplete': callback
      });
      // synchronous calibrations have now completed
      if (!async) {
        result = true;
      }
    }
    return result;
  }

  /**
   * Executes a function asynchronously or synchronously.
   * @private
   * @param {Object} me The benchmark instance passed to `fn`.
   * @param {Function} fn Function to be executed.
   * @param {Boolean} [async=false] Flag to run asynchronously.
   */
  function call(me, fn, async) {
    // only attempt asynchronous calls if supported
    if (async && HAS_TIMEOUT_API) {
      me.timerId = setTimeout(function() {
        delete me.timerId;
        fn(me, async);
      }, me.CYCLE_DELAY * 1e3);
    }
    else {
      fn(me);
    }
  }

  /**
   * Clears cached compiled code for a given test function.
   * @private
   * @param {Object} me The benchmark instance used to resolve the cache entry.
   */
  function clearCompiled(me) {
    var uid = me.fn.uid,
        compiled = cache.compiled;

    if (compiled[uid]) {
      delete compiled[uid];
      // run garbage collection in IE
      if (isHostType(window, 'CollectGarbage')) {
        CollectGarbage();
      }
    }
  }

  /**
   * Clocks the time taken to execute a test per cycle (seconds).
   * @private
   * @param {Object} me The benchmark instance.
   * @returns {Object} An object containing the clocked time and loops taken.
   */
  function clock(me) {
    var count = me.count,
        fn = me.fn,
        compilable = !HAS_FUNC_DECOMP ? -1 : fn.compilable,
        times = me.times,
        result = { 'looped': 0, 'time': 0 };

    // fn compilable modes:
    //  1 is unrolled
    //  0 is hybrid (unroll + while loop)
    // -1 is just while loop
    if (!fn.unclockable) {
      if (compilable == null || compilable > -1) {
        try {
          if (compilable == null) {
            // determine if unrolled code is exited early, caused by rogue
            // return statement, by checking for a return object with the uid
            me.count = 1;
            compilable = fn.compilable = embed(me)(me, timerNS).uid == EMBEDDED_UID ? 1 : -1;
            me.count = count;
          }
          if (compilable > -1) {
            result = embed(me)(me, timerNS);
          }
        } catch(e) {
          me.count = count;
          compilable = fn.compilable = -1;
        }
      }
      // fallback to simple while loop when compilable is -1
      if (compilable < 0) {
        result = embed(me)(me, timerNS);
      }
    }
    delete result.uid;
    return result;
  }

  /**
   * Creates a function composed of the test body and timers.
   * @private
   * @param {Object} me The benchmark instance.
   * @returns {Function} The compiled function.
   */
  function embed() {
    var args,
        fallback,
        whileLoop,
        code = [
          'var r$,i$=m$.count,l$=i$,f$=m$.fn,#{start};\n',
          '#{end};return{looped:i$<0?l$:0,time:r$,uid:"$"}',
          'f$()}',
          'while(i$--){',
          'm$,n$'
        ];

    // lazily defined to give Java applets time to initialize
    embed = function(me) {
      var into,
          shift,
          count = me.count,
          head = code[0],
          fn = me.fn,
          limit = 51e3,
          most  = Math.floor(limit * 0.75),
          prefix = '',
          lastCycle = cache.compiled[fn.uid] || { },
          lastCount = lastCycle.count,
          lastBody = lastCycle.body,
          body = lastBody || '',
          remainder = count;

      if (fn.compilable < 0) {
        return fallback;
      }
      if (lastCount != count) {
        // extract test body
        body = (String(fn).match(/^[^{]+{([\s\S]*)}\s*$/) || 0)[1];
        // cleanup test body
        body = trim(body).replace(/([^\n;])$/, '$1\n');

        // create unrolled test cycle
        if (body && count > 1) {

          // compile faster by using the last cycles unrolled cached as much as possible
          if (lastCount) {
            // number of times to repeat the last cycles unrolled body
            into = Math.floor(remainder / lastCount);
            // how much is left to unroll
            remainder -= lastCount * into;

            // switch to hybrid compiling for larger strings (50mb+)
            if (body.length * count > limit) {
              fn.compilable = 0;

              // push unrolled cache to about 75% of the string limit,
              // leaving a little wiggle room for further reducing the remainder
              if (shift = Math.max(0, Math.floor(most / lastBody.length) - 1)) {
                lastBody = lastCycle.body += repeat(lastBody, shift);
                lastCount = lastCycle.count *= shift + 1;
                into = Math.floor(count / lastCount);
                remainder = count - (lastCount * into);
              }
              // pack as many new unrolled tests into the while loop as possible
              if (shift = Math.floor(Math.max(0, most - lastBody.length) / body.length)) {
                lastBody = lastCycle.body += repeat(body, shift);
                lastCycle.count += shift;
                remainder -= shift;
              }
              // reduce remainder by shifting more unrolled to the while loop
              if (shift = remainder && lastBody.length < limit && Math.floor(remainder / into)) {
                lastBody = lastCycle.body += repeat(body, shift);
                lastCycle.count += shift;
                remainder -= shift;
              }
              // compile while loop
              head = head.replace(/(i\d+=)[^,]+/, '$1' + into);
              prefix = whileLoop + lastBody + '}';
            }
            else {
              prefix = repeat(lastBody, into);
            }
          }
          // compile unrolled body
          body = prefix + (remainder ? repeat(body, remainder) : '');

          // cache if not hybrid compiling
          if (head == code[0]) {
            cache.compiled[fn.uid] = { 'count': count, 'body': body };
          }
        }
      }
      return Function(args, head + body + code[1]);
    };

    // define root namespace of timer API
    try {
      // true for Java environments and possibly Firefox
      timerNS = java.lang.System;
    } catch(e) {
      // check Java applets
      each(window.document && document.applets || [], function(applet) {
        // check type in case Safari returns an object instead of a number
        try {
          timerNS || (timerNS = typeof applet.nanoTime() == 'number' && applet);
        } catch(e) { }
      });
      // check Chrome's microsecond timer
      timerNS || (timerNS = typeof window.chrome == 'object' && chrome);
      timerNS || (timerNS = typeof window.chromium == 'object' && chromium);
      timerNS || (timerNS = window);
    }

    // Java System.nanoTime()
    // http://download.oracle.com/javase/6/docs/api/java/lang/System.html#nanoTime()
    code = code.join('|');
    if ('nanoTime' in timerNS) {
      timerRes = 'ns';
      code = interpolate(code, {
        'start': 's$=n$.nanoTime()',
        'end': 'r$=(n$.nanoTime()-s$)/1e9'
      });
    }
    // enable benchmarking via the --enable-benchmarking flag
    // in at least Chrome 7 to use chrome.Interval
    else if (typeof timerNS.Interval == 'function') {
      timerRes = 'us';
      code = interpolate(code, {
        'start': 's$=new n$.Interval;s$.start()',
        'end': 's$.stop();r$=s$.microseconds()/1e6'
      });
    }
    else if (typeof Date.now == 'function') {
      timerNS = window;
      code = interpolate(code, {
        'start': 's$=n$.Date.now()',
        'end': 'r$=(n$.Date.now()-s$)/1e3'
      });
    }
    else {
      timerNS = window;
      code = interpolate(code, {
        'start': 's$=(new n$.Date).getTime()',
        'end': 'r$=((new n$.Date).getTime()-s$)/1e3'
      });
    }

    // inject uid into variable names to avoid collisions with embedded tests
    code = code.replace(/\$/g, EMBEDDED_UID).split('|');
    args = code.pop();
    whileLoop = code.pop();

    // create non-embedding fallback
    fallback = Function(args, code[0] + whileLoop + code.pop() + code[1]);

    // is function decompilation supported?
    (function() {
      var x = new Benchmark(function() { return 1; }, { 'count': 1 });
      try { HAS_FUNC_DECOMP = embed(x)(x, timerNS) == 1; } catch(e) { }
      cache.counter = 0;
    }());

    // define Benchmark#MIN_TIME
    (function() {
      var time,
          divisor = 1e3,
          proto = Benchmark.prototype,
          start = +new Date;

      if (!proto.MIN_TIME) {
        if (timerRes == 'us') {
          divisor = 1e6;
          time = new timerNS.Interval;
          time.start();
          while(!(timerMin = time.microseconds()));
        }
        else if (timerRes == 'ns') {
          divisor = 1e9;
          start = timerNS.nanoTime();
          while(!(timerMin = timerNS.nanoTime() - start));
        }
        else {
          while(!(timerMin = +new Date - start));
        }
        // percent uncertainty of 1%
        time = timerMin / 2 / 0.01 / divisor;
        // convert smallest measurable time to seconds
        timerMin /= divisor;
        // round up for IE
        proto.MIN_TIME = time > 0.7 ? + (time + 1e-3).toFixed(1) : time;
      }
    }());

    // execute lazy defined embed
    return embed.apply(null, arguments);
  };

  /*--------------------------------------------------------------------------*/

  /**
   * A generic bare-bones Array#forEach solution.
   * Callbacks may terminate the loop by explicitly returning false.
   * @static
   * @member Benchmark
   * @param {Array} array The array to iterate over.
   * @param {Function} callback The function called per iteration.
   */
  function each(array, callback) {
    var i = -1,
        length = array.length;

    while (++i < length) {
      if (i in array && callback(array[i], i, array) === false) {
        break;
      }
    }
  }

  /**
   * Copies source properties to the destination object.
   * @static
   * @member Benchmark
   * @param {Object} destination The destination object.
   * @param {Object} [source={}] The source object.
   * @returns {Object} The destination object.
   */
  function extend(destination, source) {
    forIn(source || { }, function(value, key) {
      destination[key] = value;
    });
    return destination;
  }

  /**
   * A generic bare-bones Array#filter solution.
   * @static
   * @member Benchmark
   * @param {Array} array The array to iterate over.
   * @param {Function} callback The function called per iteration.
   * @returns {Array} A new array of values that passed callback filter.
   */
  function filter(array, callback) {
    return reduce(array, function(result, value, index) {
      return callback(value, index, array) ? result.push(value) && result : result;
    }, []);
  }

  /**
   * A generic bare-bones for-in solution for an object's own properties.
   * @static
   * @member Benchmark
   * @param {Object} object The object to iterate over.
   * @param {Function} callback The function called per iteration.
   */
  function forIn(object, callback) {
    for (var key in object) {
      if (hasKey(object, key) && callback(object[key], key, object) === false) {
        break;
      }
    }
  }

  /**
   * Converts a number to a more readable comma separated string representation.
   * @static
   * @member Benchmark
   * @param {Number} number The number to convert.
   * @returns {String} The more readable string representation.
   */
  function formatNumber(number) {
    var comma = ',',
        string = String(Math.max(0, Math.abs(number).toFixed(0))),
        length = string.length,
        end = /^\d{4,}$/.test(string) ? length % 3 : 0;

    return (end ? string.slice(0, end) + comma : '') +
      string.slice(end).replace(/(\d{3})(?=\d)/g, '$1' + comma);
  }

  /**
   * Checks if an object has the specified key as a direct property.
   * @static
   * @member Benchmark
   * @param {Object} object The object to check.
   * @param {String} key The key to check for.
   * @returns {Boolean} Returns true if key is a direct property, else false.
   */
  function hasKey(object, key) {
    var result,
        ctor = object.constructor,
        proto = Object.prototype;

    // for modern browsers
    object = Object(object);
    if (typeof hasOwnProperty == 'function') {
      result = hasOwnProperty.call(object, key);
    }
    // for Safari 2
    else if (cache.__proto__ == proto) {
      object.__proto__ = [object.__proto__, object.__proto__ = null, result = key in object][0];
    }
    // for others (not as accurate)
    else {
      result = key in object && (ctor && ctor.prototype
        ? object[key] !== ctor.prototype[key]
        : object[key] !== proto[key]);
    }
    return result;
  }

  /**
   * A generic bare-bones Array#indexOf solution.
   * @static
   * @member Benchmark
   * @param {Array} array The array to iterate over.
   * @param {Mixed} value The value to search for.
   * @returns {Number} The index of the matched value or -1.
   */
  function indexOf(array, value) {
    var result = -1;
    each(array, function(v, i) {
      if (v === value) {
        result = i;
        return false;
      }
    });
    return result;
  }

  /**
   * Invokes a given method, with arguments, on all benchmarks in an array.
   * @static
   * @member Benchmark
   * @param {Array} benches Array of benchmarks to iterate over.
   * @param {String|Object} methodName Name of method to invoke or options object.
   * @param {Array} args Arguments to invoke the method with.
   */
  function invoke(benches, methodName, args) {
    var async,
        bench,
        queued,
        i = 0,
        length = benches.length,
        options = { 'onComplete': noop, 'onCycle': noop };

    function onInvoke(me) {
      var listeners;

      // insert invoke's "complete" listener before others so it's executed first
      if (async) {
        me.on('complete', onComplete);
        listeners = me.events['complete'];
        listeners.splice(0, 0, listeners.pop());
      }
      // execute method
      me[methodName].apply(me, args || []);
      // if synchronous return next benchmark after completing the current
      return !async && onComplete(me);
    }

    function onComplete(me) {
      var next;

      // remove invoke's "complete" listener and call the rest
      if (async) {
        me.removeListener('complete', onComplete);
        me.emit('complete');
      }
      // choose next benchmark if not exiting early
      if (options.onCycle(me) !== false) {
        if (queued) {
          next = benches.shift();
        } else if (++i < length) {
          next = benches[i];
        }
      }
      if (next) {
        if (async) {
          call(next, onInvoke, async);
        } else {
          return next;
        }
      } else {
        options.onComplete(me);
      }
      // when async the `return false` will cancel the rest of the "complete"
      // listeners because they were called above and when synchronous it will
      // end the while loop
      return false;
    }

    // juggle arguments
    if (arguments.length == 2 && typeof methodName == 'object') {
      options = extend(options, methodName);
      args = isArray(args = options.args || []) ? args : [args];
      methodName = options.methodName;
      queued = options.queued;

      // for use with Benchmark#run only
      if ('async' in options) {
        async = options.async;
      } else if (isClassOf(args[0], 'Boolean')) {
        async = args[0];
      }
      async = async && HAS_TIMEOUT_API;
    }
    // start iterating over the array
    if (bench = queued ? benches.shift() : benches[0]) {
      if (async) {
        onInvoke(bench);
      } else {
        while (bench = onInvoke(bench));
      }
    }
  }

  /**
   * Modify a string by replacing named tokens with matching object property values.
   * @static
   * @member Benchmark
   * @param {String} string The string to modify.
   * @param {Object} object The template object.
   * @returns {String} The modified string.
   */
  function interpolate(string, object) {
    string = string == null ? '' : string;
    forIn(object || { }, function(value, key) {
      string = string.replace(RegExp('#\\{' + key + '\\}', 'g'), value);
    });
    return string;
  }

  /**
   * Determines if the given value is an array.
   * @static
   * @member Benchmark
   * @param {Mixed} value The value to check.
   * @returns {Boolean} Returns true if value is an array, else false.
   */
  function isArray(value) {
    return isClassOf(value, 'Array');
  }

  /**
   * Checks if calibration benchmarks have completed.
   * @static
   * @member Benchmark
   * @returns {Boolean} Returns true if calibrated, false if not.
   */
  function isCalibrated() {
    return !filter(Benchmark.CALIBRATIONS,
      function(cal) { return !cal.cycles; }).length;
  }

  /**
   * Checks if an object is of the specified class.
   * @static
   * @member Benchmark
   * @param {Object} object The object.
   * @param {String} name The name of the class.
   * @returns {Boolean} Returns true if of the class, else false.
   */
  function isClassOf(object, name) {
    return {}.toString.call(object).slice(8, -1) == name;
  }

  /**
   * Host objects can return type values that are different from their actual
   * data type. The objects we are concerned with usually return non-primitive
   * types of object, function, or unknown.
   * @static
   * @member Benchmark
   * @param {Mixed} object The owner of the property.
   * @param {String} property The property name to check.
   * @returns {Boolean} Returns true if the property value is a non-primitive, else false.
   */
  function isHostType(object, property) {
    return !/^(?:boolean|number|string|undefined)$/
      .test(typeof object[property]) && !!object[property];
  }

  /**
   * Creates a string of joined array values or object key-value pairs.
   * @static
   * @member Benchmark
   * @param {Array|Object} object The object to operate on.
   * @param {String} [separator1=','] The separator used between key-value pairs.
   * @param {String} [separator2=': '] The separator used between keys and values.
   * @returns {String} The joined result.
   */
  function join(object, separator1, separator2) {
    var pairs = [];
    if (isArray(object)) {
      pairs = object;
    }
    else {
      separator2 || (separator2 = ': ');
      forIn(object, function(value, key) {
        pairs.push(key + separator2 + value);
      });
    }
    return pairs.join(separator1 || ',');
  }

  /**
   * A generic bare-bones Array#map solution.
   * @static
   * @member Benchmark
   * @param {Array} array The array to iterate over.
   * @param {Function} callback The function called per iteration.
   * @returns {Array} A new array of values returned by the callback.
   */
  function map(array, callback) {
    return reduce(array, function(result, value, index) {
      result.push(callback(value, index, array));
      return result;
    }, []);
  }

  /**
   * A no operation function.
   * @static
   * @member Benchmark
   */
  function noop() {
    // no operation performed
  }

  /**
   * A generic bare-bones Array#reduce solution.
   * @static
   * @member Benchmark
   * @param {Array} array The array to iterate over.
   * @param {Function} callback The function called per iteration.
   * @param {Mixed} accumulator Initial value of the accumulator.
   * @returns {Mixed} The accumulator.
   */
  function reduce(array, callback, accumulator) {
    each(array, function(value, index) {
      accumulator = callback(accumulator, value, index, array);
    });
    return accumulator;
  }

  /**
   * Repeat a string a given number of times using the `Exponentiation by squaring` algorithm.
   * http://www.merlyn.demon.co.uk/js-misc0.htm#MLS
   * @static
   * @member Benchmark
   * @param {String} string The string to repeat.
   * @param {Number} count The number of times to repeat the string.
   * @returns {String} The repeated string.
   */
  function repeat(string, count) {
    if (count < 1) return '';
    if (count % 2) return repeat(string, count - 1) + string;
    var half = repeat(string, count / 2);
    return half + half;
  }

  /**
   * A generic bare-bones String#trim solution.
   * @static
   * @member Benchmark
   * @param {String} string The string to trim.
   * @returns {String} The trimmed string.
   */
  function trim(string) {
    return string.replace(/^\s+/, '').replace(/\s+$/, '');
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Registers a single listener of a specified event type.
   * @member Benchmark
   * @param {String} type The event type.
   * @param {Function} listener The function called when the event occurs.
   * @returns {Object} The benchmark instance.
   */
  function addListener(type, listener) {
    var me = this,
        events = me.events || (me.events = { }),
        listeners = events[type] || (events[type] = []);

    listeners.push(listener);
    return me;
  }

  /**
   * Executes all registered listeners of a specified event type.
   * @member Benchmark
   * @param {String} type The event type.
   */
  function emit(type) {
    var me = this,
        args = [me].concat(slice.call(arguments, 1)),
        events = me.events,
        listeners = events && events[type] || [],
        successful = true;

    each(listeners, function(listener) {
      if (listener.apply(me, args) === false) {
        successful = false;
        return successful;
      }
    });
    return successful;
  }

  /**
   * Unregisters a single listener of a specified event type.
   * @member Benchmark
   * @param {String} type The event type.
   * @param {Function} listener The function to unregister.
   * @returns {Object} The benchmark instance.
   */
  function removeListener(type, listener) {
    var me = this,
        events = me.events,
        listeners = events && events[type] || [],
        index = indexOf(listeners, listener);

    if (index > -1) {
      listeners.splice(index, 1);
    }
    return me;
  }

  /**
   * Unregisters all listeners of a specified event type.
   * @member Benchmark
   * @param {String} type The event type.
   * @returns {Object} The benchmark instance.
   */
  function removeAllListeners(type) {
    var me = this,
        events = me.events,
        listeners = events && events[type] || [];

    listeners.length = 0;
    return me;
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Aborts the benchmark as well as in progress calibrations without recording times.
   * @member Benchmark
   */
  function abort() {
    var me = this;
    if (me.running) {
      if (me.constructor != Calibration) {
        invoke(Benchmark.CALIBRATIONS, 'abort');
      }
      if (me.timerId && HAS_TIMEOUT_API) {
        clearTimeout(me.timerId);
        delete me.timerId;
      }
      // set running as NaN so reset() will detect it as falsey and *not* call abort(),
      // but *will* detect it as a change and fire the onReset() callback
      me.running = NaN;
      me.reset();
      me.aborted = true;
      me.emit('abort');
    }
  }

  /**
   * Creates a cloned benchmark with the same test function and options.
   * @member Benchmark
   * @param {Object} options Overwrite cloned options.
   * @returns {Object} Cloned instance.
   */
  function clone(options) {
    var me = this,
        result = new me.constructor(me.fn, extend(extend({ }, me.options), options));

    // copy manually added properties
    forIn(me, function(value, key) {
      if (!hasKey(result, key)) {
        result[key] = value;
      }
    });
    result.reset();
    return result;
  }

  /**
   * Determines if the benchmark's hertz is higher than another.
   * @static
   * @member Benchmark
   * @param {Object} other The benchmark to compare.
   * @returns {Number} Returns 1 if higher, -1 if lower, and 0 if indeterminate.
   */
  function compare(other) {
    var me = this,
        a = { 'lower': me.hz - me.MoE,       'upper': me.hz + me.MoE },
        b = { 'lower': other.hz - other.MoE, 'upper': other.hz + other.MoE };
    return a.lower <= b.upper && a.upper >= b.lower ? 0 : a.lower > b.lower ? 1 : -1;
  }

  /**
   * Reset properties and abort if running.
   * @member Benchmark
   */
  function reset() {
    var changed,
        me = this,
        keys = 'MoE RME SD SEM aborted count cycles error hz running'.split(' '),
        timeKeys = 'cycle elapsed period start stop'.split(' '),
        times = me.times,
        proto = me.constructor.prototype;

    if (me.running) {
      // no worries, reset() is called within abort()
      me.abort();
      me.aborted = proto.aborted;
    }
    else {
      // check if properties have changed and reset them
      each(keys, function(key) {
        if (me[key] != proto[key]) {
          changed = true;
          me[key] = proto[key];
        }
      });
      each(timeKeys, function(key) {
        if (times[key] != proto.times[key]) {
          changed = true;
          times[key] = proto.times[key];
        }
      });
      if (changed) {
        me.emit('reset');
      }
    }
  }

  /**
   * Displays relevant benchmark information when coerced to a string.
   * @member Benchmark
   */
  function toString() {
    var me = this,
        cycles = me.cycles,
        name = me.name || me.id || ('<Test #' + me.fn.uid + '>'),
        jre = isHostType(window, 'java') && !isHostType(window, 'netscape'),
        pm = jre ? '\xf1' : '\xb1',
        x = jre ? 'x' : '\xd7';

    return name + ' ' + x + ' ' + formatNumber(me.hz) + ' ' + pm +
      me.RME.toFixed(2) + '% (' + cycles + ' cycle' + (cycles == 1 ? '' : 's') + ')';
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Performs statistical calculations on benchmark results.
   * @private
   * @param {Object} me The benchmark instance.
   * @param {Boolean} [async=false] Flag to run asynchronously.
   */
  function compute(me, async) {
    var calibrating = me.constructor == Calibration,
        fn = me.fn,
        initCompilable = fn.compilable,
        initRunCount = me.INIT_RUN_COUNT,
        initSampleSize = 5,
        initUnclockable = fn.unclockable,
        queue = [],
        sample = [],
        state = { 'calibrated': isCalibrated(), 'compilable': initCompilable };

    function initialize() {
      me.cycles = 0;
      me.INIT_RUN_COUNT = initRunCount;
      clearQueue();
      clearCompiled(me);
      enqueue(initSampleSize);
    }

    function clearQueue() {
      queue.length = sample.length = 0;
    }

    function enqueue(count) {
      while (count--) {
        sample.push(queue[queue.push(me.clone({
          'computing': queue,
          'onAbort': noop,
          'onReset': noop,
          'onComplete': onComplete,
          'onCycle': onCycle,
          'onStart': onStart
        })) - 1]);
      }
    }

    function onComplete(clone) {
      // update host run count and init compilable state
      me.INIT_RUN_COUNT = clone.INIT_RUN_COUNT;
      if (state.compilable == null) {
        state.compilable = fn.compilable;
      }
    }

    function onCycle(clone) {
      // map changes from clone to host
      if (me.running) {
        if (clone.cycles) {
          me.count = clone.count;
          me.cycles += clone.cycles;
          me.hz = clone.hz;
          me.times.period = clone.times.period;
          me.emit('cycle');
        }
        else if (clone.error) {
          me.abort();
          me.error = clone.error;
          me.emit('error');
        }
      }
      else if (me.aborted) {
        clone.abort();
      }
    }

    function onStart(clone) {
      // reset timer if interrupted by calibrations
      if (!calibrating && !state.calibrated && isCalibrated()) {
        state.calibrated = true;
        me.times.start = +new Date;
      }
      // update run count
      clone.count = clone.INIT_RUN_COUNT = me.INIT_RUN_COUNT;
      onCycle(clone);
    }

    function onInvokeCycle(clone) {
      var complete,
          mean,
          moe,
          rme,
          sd,
          sem,
          compilable = fn.compilable,
          now = +new Date,
          times = me.times,
          aborted = me.aborted,
          elapsed = (now - times.start) / 1e3,
          sampleSize = sample.length,
          sumOf = function(sum, clone) { return sum + clone.hz; },
          varianceOf = function(sum, clone) { return sum + Math.pow(clone.hz - mean, 2); };

      // avoid computing unclockable tests
      if (fn.unclockable) {
        clearQueue();
      }
      // exit early if aborted
      if (aborted) {
        complete = true;
      }
      // start over if switching compilable state
      else if (state.compilable != compilable) {
        state.compilable = compilable;
        times.start = +new Date;
        initialize();
      }
      // simulate onComplete and enqueue additional runs if needed
      else if (!queue.length || sampleSize > initSampleSize) {
        // compute values
        mean = reduce(sample, sumOf, 0) / sampleSize || 0;
        // standard deviation
        sd = Math.sqrt(reduce(sample, varianceOf, 0) / (sampleSize - 1)) || 0;
        // standard error of the mean
        sem =  sd / Math.sqrt(sampleSize) || 0;
        // margin of error
        moe = sem * (T_DISTRIBUTION[sampleSize - 1] || T_DISTRIBUTION.Infinity);
        // relative margin of error
        rme = (moe / mean) * 100 || 0;

        // if time permits, or calibrating, increase sample size to reduce the margin of error
        if (rme > 1 && (elapsed < me.MAX_TIME_ELAPSED || rme > 50 || calibrating || queue.length)) {
          if (!queue.length) {
            // quadruple sample size to cut the margin of error in half
            enqueue(rme > 50 ? sampleSize * 3 : 1);
          }
        }
        // finish up
        else {
          complete = true;

          // set statistical data
          me.MoE = moe;
          me.RME = rme;
          me.SD  = sd;
          me.SEM = sem;

          // set host results
          me.count = clone.count;
          me.running = false;
          times.stop = now;
          times.elapsed = elapsed;

          if (clone.hz != Infinity) {
            me.hz = mean;
            times.period = 1 / mean;
            times.cycle = times.period * me.count;
          }
        }
      }
      // cleanup
      if (complete) {
        clearQueue();
        clearCompiled(me);
        fn.compilable = initCompilable;
        fn.unclockable = initUnclockable;
        me.INIT_RUN_COUNT = initRunCount;
        me.emit('complete');
      }
      return !aborted;
    }

    // init queue and sample
    initialize();

    // run them
    invoke(queue, {
      'async': async == null ? me.DEFAULT_ASYNC : async,
      'methodName': 'run',
      'queued': true,
      'onCycle': onInvokeCycle
    });
  }

  /**
   * Executes each run cycle and computes results.
   * @private
   * @param {Object} me The benchmark instance.
   * @param {Boolean} [async=false] Flag to run asynchronously.
   */
  function _run(me, async) {
    var clocked,
        compilable;

    function onCalibrate(cal) {
      if (cal.aborted) {
        me.abort();
        me.emit('complete');
      } else if (me.running) {
        call(me, finish, async);
      }
    }

    function finish() {
      var divisor,
          period,
          fn = me.fn,
          index = me.CALIBRATION_INDEX,
          times = me.times,
          cals = me.constructor.CALIBRATIONS || [],
          cal = cals[(index > 0 || fn.compilable < 1) && index],
          count = me.count,
          minTime = me.MIN_TIME;

      if (me.running) {
        // calibrate by subtracting iteration overhead
        clocked = times.cycle = Math.max(0,
          clocked.time - (cal && cal.times.period || 0) * clocked.looped);

        // smells like Infinity ?
        clocked = Math.min(timerMin, clocked) / Math.max(timerMin, clocked) > 0.9 ? 0 : clocked;

        // seconds per operation
        period = times.period = clocked / count;

        // ops per second
        me.hz = 1 / period;

        // do we need to do another cycle?
        me.running = !fn.unclockable && clocked < minTime;

        // avoid working our way up to this next time
        me.INIT_RUN_COUNT = count;

        if (me.running) {
          // tests may clock at 0 when INIT_RUN_COUNT is a small number,
          // to avoid that we set its count to something a bit higher
          if (!clocked && (divisor = CYCLE_DIVISORS[me.cycles]) != null) {
            count = Math.floor(4e6 / divisor);
          }
          // calculate how many more iterations it will take to achive the MIN_TIME
          if (count <= me.count) {
            count += Math.ceil((minTime - clocked) / period);
          }
          // give up and declare the test unclockable
          if (!(me.running = count != Infinity)) {
            fn.unclockable = true;
            clearCompiled(me);
          }
        }
        // should we exit early?
        if (me.emit('cycle') === false) {
          me.abort();
        }
      }
      // figure out what to do next
      if (me.running) {
        me.count = count;
        call(me, _run, async);
      } else {
        me.emit('complete');
      }
    }

    // continue, if not aborted between cycles
    if (me.running) {
      me.cycles++;
      try {
        // used by finish()
        clocked = clock(me);
      }
      catch(e) {
        me.abort();
        me.error = e;
        me.emit('error');
      }
    }
    // check if calibration is needed
    if (me.running) {
      compilable = me.fn.compilable;
      if (compilable == null || compilable > 0 || me.constructor == Calibration ||
          (compilable < 1 && calibrate(me, onCalibrate, async))) {
        finish();
      }
    } else {
      finish();
    }
  }

  /**
   * Starts running the benchmark.
   * @member Benchmark
   * @param {Boolean} [async=false] Flag to run asynchronously.
   */
  function run(async) {
    var me = this;
    async = async == null ? me.DEFAULT_ASYNC : async;

    // set running to false so reset() won't call abort()
    me.running = false;
    me.reset();
    me.running = true;
    me.count = me.INIT_RUN_COUNT;
    me.times.start = +new Date;
    me.emit('start');

    if (me.computing) {
      _run(me, async);
    } else {
      compute(me, async);
    }
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Platform object containing browser name, version, and operating system.
   * @static
   * @member Benchmark
   */
  Benchmark.platform = (function() {
    var me = this,
        alpha = '\u03b1',
        beta = '\u03b2',
        description = [],
        doc = window.document && document || {},
        nav = window.navigator && navigator || {},
        ua = nav.userAgent || 'unknown platform',
        layout = /Gecko|Trident|WebKit/.exec(ua),
        data = { '6.1': '7', '6.0': 'Vista', '5.2': 'Server 2003 / XP x64', '5.1': 'XP', '5.0': '2000', '4.0': 'NT', '4.9': 'ME' },
        name = 'Avant Browser,Camino,Epiphany,Fennec,Flock,Galeon,GreenBrowser,iCab,Iron,K-Meleon,Konqueror,Lunascape,Maxthon,Minefield,RockMelt,SeaMonkey,Sleipnir,SlimBrowser,Sunrise,Swiftfox,Opera,Chrome,Firefox,IE,Safari',
        os = 'webOS[ /]\\d,Linux,Mac OS(?: X)?,Macintosh,Windows 98;,Windows ',
        product = 'Android,BlackBerry\\s?\\d+,iP[ao]d,iPhone',
        version = isClassOf(window.opera, 'Opera') && opera.version();

    name = reduce(name.split(','), function(name, guess) {
      return name || (name = RegExp(guess + '\\b', 'i').exec(ua) && guess);
    });

    product = reduce(product.split(','), function(product, guess) {
      return product || (product = RegExp(guess + '[^();/-]*').exec(ua));
    });

    os = reduce(os.split(','), function(os, guess) {
      if (!os && (os = RegExp(guess + '[^();/-]*').exec(ua))) {
        // platform tokens defined at
        // http://msdn.microsoft.com/en-us/library/ms537503(VS.85).aspx
        if (/Windows/.test(os) && (data = data[0/*opera fix*/,/[456]\.\d/.exec(os)])) {
          os = 'Windows ' + data;
        }
        // normalize iOS
        else if (/^iP/.test(product)) {
          name || (name = 'Safari');
          os = 'iOS' + ((data = /\bOS ([\d_]+)/.exec(ua)) ? ' ' + data[1] : '');
        }
        // avoid detecting an OS for products
        else if (product) {
          return null;
        }
        // linux <3s underscores
        if (!/Linux/.test(os)) {
          os = String(os).replace(/_/g, '.');
        }
        // cleanup
        if (/Mac/.test(os)) {
          os = String(os).replace(/ Mach$/, '').replace('Macintosh', 'Mac OS');
        }
        os = trim(String(os).replace(/\/(\d)/, ' $1').split(' on ')[0]);
      }
      return os;
    });

    // detect non Opera versions
    version = reduce(/webOS/.test(os) ? [name] : ['version', /fox/.test(name) ? 'Firefox' : name, product], function(version, guess, i) {
      return version || (version = (RegExp(guess + (i == 1 ? '[ /-]' : '/') + '([^ ();/-]*)', 'i').exec(ua) || 0)[1]);
    }, version);

    // cleanup product
    product = product && trim(String(product).replace(/([a-z])(\d)/i, '$1 $2').split('-')[0]);

    // detect server-side js
    if (me && isHostType(me, 'global')) {
      if (typeof exports == 'object' && exports) {
        if (me == window && typeof system == 'object' && system) {
          name = system.global == global ? 'Narwhal' : 'RingoJS';
          os = system.os;
        }
        else if ((data = me.process) && typeof data == 'object') {
          name = 'Node.js';
          version = /[\d.]+/.exec(data.version)[0];
          os = data.platform;
        }
        os = os && (os.charAt(0).toUpperCase() + os.slice(1));
      }
      else if (isClassOf(me.environment, 'Environment')) {
        name = 'Rhino';
      }
      if (isHostType(me, 'java')) {
         alpha = '\xe0';
         beta  = '\xe1';
      }
    }
    // detect non Safari WebKit based browsers
    else if (product && (!name || name == 'Safari' && !/^iP/.test(product))) {
      name = /[a-z]+/i.exec(product) + ' Browser';
    }
    // detect unspecified Safari versions
    else if (name == 'Safari' && (!version || parseInt(version) > 45)) {
      data = (/AppleWebKit\/(\d+)/.exec(ua) || 0)[1] || Infinity;
      version = data < 400 ? '1.x' : data < 500 ? '2.x' : data < 526 ? '3.x' : data < 534 ? '4+' : version;
    }
    // detect IE compatibility mode
    else if (typeof doc.documentMode == 'number' && (data = /Trident\/(\d+)/.exec(ua))) {
      version = [version, doc.documentMode];
      version[1] = (data = +data[1] + 4) != version[1] ? (layout = null, description.push('running in IE ' + version[1] + ' mode'), data) : version[1];
      version = name == 'IE' ? String(version[1].toFixed(1)) : version[0];
    }
    // detect release phases
    if (version && (data = /(?:[ab]|dp|pre|[ab]\dpre)\d?\+?$/i.exec(version) || /(?:alpha|beta) ?\d?/i.exec(ua + ';' + nav.appMinorVersion))) {
      version = version.replace(RegExp(data + '\\+?$'), '') + (/^b/i.test(data) ? beta : alpha) + (/\d+\+?/.exec(data) || '');
    }
    // detect Maxthon's unreliable version info
    if (name == 'Maxthon') {
      version = version && version.replace(/\.[.\d]*/, '.x');
    }
    // detect Firefox nightly
    else if (name == 'Minefield') {
      name = 'Firefox';
      version = RegExp(alpha + '|' + beta + '|null').test(version) ? version : version + alpha;
    }
    // detect mobile
    else if (name && !product && /Mobi/.test(ua)) {
      name += ' Mobile';
    }
    // detect platform preview
    if (RegExp(alpha + '|' + beta).test(version) && typeof window.external == 'object' && !external) {
      description.unshift('platform preview');
    }
    // detect layout engines
    if (layout && RegExp(/[a-z]+/i.exec(product) + '|Lunascape|Maxthon|Sleipnir').test(name)) {
      description.push((/preview/.test(description) ? 'rendered by ' : '') + layout);
    }
    // add contextual information
    if (description.length) {
      description = ['(' + description.join(' ') + ')'];
    }
    return {
      'version': name && version && description.unshift(version) && version,
      'name': name && description.unshift(name) && name,
      'product': product && description.push('on ' + product) && product,
      'os': os && description.push((product ? '' : 'on ') + os) && os,
      'description': description.length ? description.join(' ') : ua,
      'toString': function() { return this.description; }
    };
  }());

  /*--------------------------------------------------------------------------*/

  extend(Benchmark, {

    /**
     * Benchmarks to establish iteration overhead.
     * @static
     * @member Benchmark
     */
    'CALIBRATIONS': (function() {
      noop.compilable = noop.uid = -1;
      return [new Calibration(noop)];
    }()),

    // generic Array#forEach
    'each': each,

    // copy properties to another object
    'extend': extend,

    // generic Array#filter
    'filter': filter,

    // iterate over an object's direct properties
    'forIn': forIn,

    // converts a number to a comma separated string
    'formatNumber': formatNumber,

    // xbrowser Object#hasOwnProperty
    'hasKey': hasKey,

    // generic Array#indexOf
    'indexOf': indexOf,

    // invokes a method of each benchmark in a collection
    'invoke': invoke,

    // modifies a string using a template object
    'interpolate': interpolate,

    // xbrowser Array.isArray
    'isArray': isArray,

    // checks calibration status
    'isCalibrated': isCalibrated,

    // checks internal [[Class]] of an object
    'isClassOf': isClassOf,

    // checks if an object's property is a non-primitive value
    'isHostType': isHostType,

    // generic Array#join for arrays and objects
    'join': join,

    // generic Array#map
    'map': map,

    // no operation
    'noop': noop,

    // generic Array#reduce
    'reduce': reduce,

    // repeats a string a number of times
    'repeat': repeat,

    // generic String#trim
    'trim': trim
  });

  /*--------------------------------------------------------------------------*/

  // IE may ignore `toString` in a for-in loop
  Benchmark.prototype.toString = toString;

  extend(Benchmark.prototype, {

    /**
     * The index of the calibration benchmark to use when computing results.
     * @member Benchmark
     */
    'CALIBRATION_INDEX': 0,

    /**
     * The delay between test cycles (secs).
     * @member Benchmark
     */
    'CYCLE_DELAY': 0.2,

    /**
     * A flag to indicate methods will run asynchronously by default.
     * @member Benchmark
     */
    'DEFAULT_ASYNC': false,

    /**
     * The default number of times to execute a test on a benchmark's first cycle.
     * @member Benchmark
     */
    'INIT_RUN_COUNT': 5,

    /**
     * The maximum time a benchmark is allowed to run before finishing (secs).
     * @member Benchmark
     */
    'MAX_TIME_ELAPSED': 8,

    /**
     * The time needed to reduce the percent uncertainty of measurement to 1% (secs).
     * @member Benchmark
     */
    'MIN_TIME': 0,

    /**
     * The margin of error.
     * @member Benchmark
     */
    'MoE': 0,

    /**
     * The relative margin of error (expressed as a percentage of the mean).
     * @member Benchmark
     */
    'RME': 0,

    /**
     * The sample standard deviation.
     * @member Benchmark
     */
    'SD': 0,

    /**
     * The standard error of the mean.
     * @member Benchmark
     */
    'SEM': 0,

    /**
     * The number of times a test was executed.
     * @member Benchmark
     */
    'count': 0,

    /**
     * The number of cycles performed while benchmarking.
     * @member Benchmark
     */
    'cycles': 0,

    /**
     * The error object if the test failed.
     * @member Benchmark
     */
    'error': null,

    /**
     * The number of executions per second.
     * @member Benchmark
     */
    'hz': 0,

    /**
     * A flag to indicate if the benchmark is running.
     * @member Benchmark
     */
    'running': false,

    /**
     * A flag to indicate if the benchmark is aborted.
     * @member Benchmark
     */
    'aborted': false,

    /**
     * An object of timing data including cycle, elapsed, period, start, and stop.
     * @member Benchmark
     */
    'times': {
      // time taken to complete the last cycle (secs).
      'cycle': 0,

      // time taken to complete the benchmark (secs).
      'elapsed': 0,

      // time taken to execute the test once (secs).
      'period': 0,

      // timestamp of when the benchmark started (ms).
      'start': 0,

      // timestamp of when the benchmark finished (ms).
      'stop': 0
    },

    // aborts benchmark (does not record times)
    'abort': abort,

    // registers a single listener
    'addListener': addListener,

    // create new benchmark with the same test function and options
    'clone': clone,

    // compares benchmark's hertz with another
    'compare': compare,

    // executes listeners of a specified type
    'emit': emit,

    // alias for addListener
    'on': addListener,

    // removes all listeners of a specified type
    'removeAllListeners': removeAllListeners,

    // removes a single listener
    'removeListener': removeListener,

    // reset benchmark properties
    'reset': reset,

    // run the benchmark
    'run': run
  });

  /*--------------------------------------------------------------------------*/

  // expose
  if (/Narwhal|Node|RingoJS/.test(Benchmark.platform.name)) {
    timerNS = timerNS == window ? global : timerNS;
    window = global;
    if (typeof module == 'object' && module.exports == exports) {
      module.exports = Benchmark;
    } else {
      exports.Benchmark = Benchmark;
    }
  } else {
    window.Benchmark = Benchmark;
  }

  // feature detect
  HAS_TIMEOUT_API = isHostType(window, 'setTimeout') &&
    isHostType(window, 'clearTimeout');

}(this));