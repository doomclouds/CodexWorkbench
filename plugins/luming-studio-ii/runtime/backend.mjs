import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
  mod
));

// ../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path2, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path2, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        })(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path2, mode, callback) {
          fs2.open(
            path2,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path2, mode) {
          var fd = fs2.openSync(path2, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path2, at, mt, cb) {
            fs2.open(path2, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd, at, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path2, at, mt) {
            var fd = fs2.openSync(path2, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target2, mode, cb) {
          return orig.call(fs, target2, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target2, mode) {
          try {
            return orig.call(fs, target2, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target2, uid, gid, cb) {
          return orig.call(fs, target2, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target2, uid, gid) {
          try {
            return orig.call(fs, target2, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target2, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target2, options, callback) : orig.call(fs, target2, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target2, options) {
          var stats = options ? orig.call(fs, target2, options) : orig.call(fs, target2);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// ../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path2, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path2, options);
        Stream.call(this);
        var self = this;
        this.path = path2;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path2, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path2, options);
        Stream.call(this);
        this.path = path2;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// ../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// ../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "../../../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs.close);
      fs.closeSync = (function(fs$closeSync) {
        function closeSync2(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync2, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync2;
      })(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream3;
      fs2.createWriteStream = createWriteStream2;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile3;
      function readFile3(path2, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path2, options, cb);
        function go$readFile(path3, options2, cb2, startTime) {
          return fs$readFile(path3, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path3, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile2;
      function writeFile2(path2, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path2, data, options, cb);
        function go$writeFile(path3, data2, options2, cb2, startTime) {
          return fs$writeFile(path3, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path2, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path2, data, options, cb);
        function go$appendFile(path3, data2, options2, cb2, startTime) {
          return fs$appendFile(path3, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir2;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir2(path2, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path3, options2, cb2, startTime) {
          return fs$readdir(path3, fs$readdirCallback(
            path3,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path3, options2, cb2, startTime) {
          return fs$readdir(path3, options2, fs$readdirCallback(
            path3,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path2, options, cb);
        function fs$readdirCallback(path3, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path3, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path2, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path2, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream3(path2, options) {
        return new fs2.ReadStream(path2, options);
      }
      function createWriteStream2(path2, options) {
        return new fs2.WriteStream(path2, options);
      }
      var fs$open = fs2.open;
      fs2.open = open2;
      function open2(path2, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path2, flags, mode, cb);
        function go$open(path3, flags2, mode2, cb2, startTime) {
          return fs$open(path3, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path3, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// ../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// ../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// ../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/index.js
var require_retry2 = __commonJS({
  "../../../../node_modules/.pnpm/retry@0.12.0/node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// ../../../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "../../../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/signals.js"(exports, module) {
    module.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// ../../../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "../../../../node_modules/.pnpm/signal-exit@3.0.7/node_modules/signal-exit/index.js"(exports, module) {
    var process3 = global.process;
    var processOk = function(process4) {
      return process4 && typeof process4 === "object" && typeof process4.removeListener === "function" && typeof process4.emit === "function" && typeof process4.reallyExit === "function" && typeof process4.listeners === "function" && typeof process4.kill === "function" && typeof process4.pid === "number" && typeof process4.on === "function";
    };
    if (!processOk(process3)) {
      module.exports = function() {
        return function() {
        };
      };
    } else {
      assert2 = __require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process3.platform);
      EE = __require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process3.__signal_exit_emitter__) {
        emitter = process3.__signal_exit_emitter__;
      } else {
        emitter = process3.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert2.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process3.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process3.emit = originalProcessEmit;
        process3.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module.exports.unload = unload;
      emit = function emit2(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener2() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process3.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit("exit", null, sig);
            emit("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process3.kill(process3.pid, sig);
          }
        };
      });
      module.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process3.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process3.emit = processEmit;
        process3.reallyExit = processReallyExit;
      };
      module.exports.load = load;
      originalProcessReallyExit = process3.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process3.exitCode = code || /* istanbul ignore next */
        0;
        emit("exit", process3.exitCode, null);
        emit("afterexit", process3.exitCode, null);
        originalProcessReallyExit.call(process3, process3.exitCode);
      };
      originalProcessEmit = process3.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process3.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit("exit", process3.exitCode, null);
          emit("afterexit", process3.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert2;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// ../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/mtime-precision.js"(exports, module) {
    "use strict";
    var cacheSymbol = /* @__PURE__ */ Symbol();
    function probe(file, fs, callback) {
      const cachedPrecision = fs[cacheSymbol];
      if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module.exports.probe = probe;
    module.exports.getMtime = getMtime;
  }
});

// ../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/lockfile.js"(exports, module) {
    "use strict";
    var path2 = __require("path");
    var fs = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path2.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock2 = locks[file];
      if (lock2.updateTimeout) {
        return;
      }
      lock2.updateDelay = lock2.updateDelay || options.update;
      lock2.updateTimeout = setTimeout(() => {
        lock2.updateTimeout = null;
        options.fs.stat(lock2.lockfilePath, (err, stat) => {
          const isOverThreshold = lock2.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock2, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock2.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock2.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock2,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock2.mtimePrecision);
          options.fs.utimes(lock2.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock2.lastUpdate + options.stale < Date.now();
            if (lock2.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock2, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock2.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock2.mtime = mtime;
            lock2.lastUpdate = Date.now();
            lock2.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock2.updateDelay);
      if (lock2.updateTimeout.unref) {
        lock2.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock2, err) {
      lock2.released = true;
      if (lock2.updateTimeout) {
        clearTimeout(lock2.updateTimeout);
      }
      if (locks[file] === lock2) {
        delete locks[file];
      }
      lock2.options.onCompromised(err);
    }
    function lock(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock2 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock2.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock2 = locks[file2];
        if (!lock2) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock2.updateTimeout && clearTimeout(lock2.updateTimeout);
        lock2.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.check = check;
    module.exports.getLocks = getLocks;
  }
});

// ../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/lib/adapter.js"(exports, module) {
    "use strict";
    var fs = require_graceful_fs();
    function createSyncFs(fs2) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs2 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs2[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve, reject2) => {
        args.push((err, result) => {
          if (err) {
            reject2(err);
          } else {
            resolve(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// ../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "../../../../node_modules/.pnpm/proper-lockfile@4.1.2/node_modules/proper-lockfile/index.js"(exports, module) {
    "use strict";
    var lockfile2 = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock(file, options) {
      const release = await toPromise(lockfile2.lock)(file, options);
      return toPromise(release);
    }
    function lockSync(file, options) {
      const release = toSync(lockfile2.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile2.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile2.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile2.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile2.check)(file, toSyncOptions(options));
    }
    module.exports = lock;
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.lockSync = lockSync;
    module.exports.unlockSync = unlockSync;
    module.exports.check = check;
    module.exports.checkSync = checkSync;
  }
});

// src/bootstrap/main.ts
import { timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { networkInterfaces } from "node:os";
import process2 from "node:process";
import { fileURLToPath } from "node:url";

// src/entrypoints/http/index.ts
import {
  createServer as createServer2
} from "node:http";

// src/modules/archives/domain/index.ts
function isArchiveIdentifier(value) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

// src/modules/archives/application/index.ts
var MAX_ARCHIVE_IMPORT_BYTES = 128 * 1024 * 1024;
var ArchiveRequestError = class extends Error {
};
function requireCommandId(value) {
  if (!isArchiveIdentifier(value)) {
    throw new ArchiveRequestError("Invalid archive command identifier.");
  }
  return value;
}
function createArchiveImportApplication(port, dependencies) {
  return {
    importCurrent(actorId2, commandId, chunks) {
      return port.importCurrent({
        actorId: actorId2,
        commandId: requireCommandId(commandId),
        boardId: dependencies.newBoardId(),
        updatedAtMillis: dependencies.now(),
        chunks
      });
    },
    getReceipt(actorId2, commandId) {
      return port.getReceipt(actorId2, requireCommandId(commandId));
    },
    getAsset(actorId2, boardId, assetId) {
      if (!isArchiveIdentifier(boardId) || !isArchiveIdentifier(assetId)) {
        throw new ArchiveRequestError("Invalid imported asset identifier.");
      }
      return port.getAsset(actorId2, boardId, assetId);
    }
  };
}

// src/modules/catalog/domain/index.ts
var maxTitleLength = 200;
var defaultBoardTitle = "\u672A\u547D\u540D\u767D\u677F";
var invalidTitleCharacters = /[\p{Cc}\p{Cs}]/u;
function normalizeBoardTitle(title) {
  const normalized = title.trim();
  if (normalized.length > maxTitleLength || invalidTitleCharacters.test(normalized)) {
    return void 0;
  }
  return normalized || defaultBoardTitle;
}
function duplicateBoardTitle(title) {
  const suffix = " \u526F\u672C";
  const source = title.trim().slice(0, maxTitleLength - suffix.length).replace(new RegExp("\\p{Cs}$", "u"), "");
  return normalizeBoardTitle(source.trimEnd() + suffix);
}
function catalogTimestamp(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("The clock returned an invalid catalog timestamp.");
  }
  return BigInt(now);
}

// src/modules/catalog/application/cursor.ts
var cursorVersion = 1;
var maxCursorLength = 4096;
var maxTimestamp = 9223372036854775807n;
var decimalTimestamp = /^(?:0|[1-9][0-9]{0,18})$/u;
var CatalogQueryError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CatalogQueryError";
  }
};
function cursorRecord(cursor) {
  if (cursor.length > maxCursorLength) {
    throw new CatalogQueryError("The catalog cursor is too long.");
  }
  let decoded;
  try {
    decoded = JSON.parse(cursor);
  } catch (cause) {
    throw new CatalogQueryError("The catalog cursor is malformed.", { cause });
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new CatalogQueryError("The catalog cursor is malformed.");
  }
  return decoded;
}
function cursorTimestamp(value) {
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string" || !decimalTimestamp.test(value)) {
    throw new CatalogQueryError("The catalog cursor timestamp is invalid.");
  }
  const timestamp2 = BigInt(value);
  if (timestamp2 > maxTimestamp) {
    throw new CatalogQueryError("The catalog cursor timestamp is out of range.");
  }
  return timestamp2;
}
function readCatalogCursor(cursor, scope2) {
  const values = cursorRecord(cursor);
  if (values.version !== cursorVersion || values.actorId !== scope2.actorId) {
    throw new CatalogQueryError("The catalog cursor is invalid for this actor.");
  }
  if (values.query !== scope2.query || values.order !== scope2.order || values.view !== scope2.view) {
    throw new CatalogQueryError("The catalog cursor belongs to another query.");
  }
  const { boardId, title, pinned, updatedAtMillis } = values;
  if (typeof boardId !== "string" || !boardId) {
    throw new CatalogQueryError("The catalog cursor board id is invalid.");
  }
  if (typeof title !== "string" || typeof pinned !== "boolean") {
    throw new CatalogQueryError("The catalog cursor position is invalid.");
  }
  const position = { boardId, title, pinned, updatedAtMillis: cursorTimestamp(updatedAtMillis) };
  if (scope2.view !== "trash") {
    return position;
  }
  const trashedAtMillis = cursorTimestamp(values.trashedAtMillis);
  if (trashedAtMillis === void 0) {
    throw new CatalogQueryError("The trash cursor timestamp is missing.");
  }
  return { ...position, trashedAtMillis };
}
function writeCatalogCursor(scope2, position) {
  const { actorId: actorId2, query, order, view } = scope2;
  const { boardId, title, pinned, updatedAtMillis, trashedAtMillis } = position;
  return JSON.stringify({
    version: cursorVersion,
    actorId: actorId2,
    query,
    order,
    view,
    boardId,
    title,
    pinned,
    updatedAtMillis: updatedAtMillis?.toString(),
    trashedAtMillis: trashedAtMillis?.toString()
  });
}

// src/modules/catalog/application/duplicate-board.ts
function duplicateBoard(repository, actorId2, command, newBoard2) {
  const { sourceBoardId, commandId } = command;
  return repository.write((writer2) => {
    const stored = writer2.getReceipt(actorId2, commandId);
    if (stored) {
      const { receipt: receipt2, duplicateSourceId } = stored;
      return duplicateSourceId === sourceBoardId && receipt2.kind === "created" ? receipt2 : { kind: "rejected", commandId, reason: "commandIdReuse" };
    }
    const source = writer2.getManagedBoard(actorId2, sourceBoardId);
    if (!source) {
      return { kind: "rejected", commandId, reason: "forbidden" };
    }
    if (source.trashedAtMillis !== void 0) {
      return { kind: "rejected", commandId, reason: "stateChanged" };
    }
    const title = duplicateBoardTitle(source.board.title);
    if (title === void 0) {
      return { kind: "rejected", commandId, reason: "invalidTitle" };
    }
    const receipt = newBoard2(commandId, title);
    const rejected5 = writer2.duplicateBoard(actorId2, sourceBoardId, receipt);
    return rejected5 ? { kind: "rejected", commandId, reason: rejected5 } : receipt;
  });
}

// src/modules/catalog/application/management.ts
var maxPurgeTargets = 100;
function rejection(commandId, reason) {
  return { kind: "rejected", commandId, reason };
}
function execute(repository, actorId2, commandId, signature, decide) {
  return repository.write((writer2) => {
    const stored = writer2.getReceipt(actorId2, commandId);
    if (stored) {
      const { receipt: receipt2 } = stored;
      return stored.signature === signature && receipt2.kind !== "created" ? receipt2 : rejection(commandId, "commandIdReuse");
    }
    const receipt = decide(writer2);
    writer2.saveManagementReceipt(actorId2, signature, receipt);
    return receipt;
  });
}
function validTarget(target2) {
  return target2.boardId.trim().length > 0 && target2.expectedEntryVersion >= 0n;
}
function targetMismatch(managed, target2, requiresTrash) {
  const inTrash = managed.trashedAtMillis !== void 0;
  if (inTrash !== requiresTrash) {
    return "stateChanged";
  }
  if (managed.board.entryVersion !== target2.expectedEntryVersion) {
    return "entryVersionChanged";
  }
}
function titleForChange(operation, title) {
  if (operation.kind !== "rename") {
    return title;
  }
  const requested = operation.title.trim();
  return requested ? normalizeBoardTitle(requested) : void 0;
}
function manage(writer2, actorId2, command, now) {
  const { boardId, commandId, operation } = command;
  const managed = writer2.getManagedBoard(actorId2, boardId);
  if (!managed) {
    return rejection(commandId, "forbidden");
  }
  const mismatch = targetMismatch(managed, command, operation.kind === "restore");
  if (mismatch) {
    return rejection(commandId, mismatch);
  }
  const title = titleForChange(operation, managed.board.title);
  if (title === void 0) {
    return rejection(commandId, "invalidTitle");
  }
  const updatedAtMillis = catalogTimestamp(now());
  const board = {
    ...managed.board,
    title,
    updatedAtMillis,
    pinned: operation.kind === "pin" ? operation.pinned : managed.board.pinned,
    entryVersion: managed.board.entryVersion + 1n
  };
  const trashedAtMillis = operation.kind === "trash" ? updatedAtMillis : void 0;
  writer2.changeBoard({ board, trashedAtMillis });
  return { kind: "changed", commandId, board };
}
function manageSignature(command) {
  const { operation, boardId, expectedEntryVersion } = command;
  const signature = ["manage", boardId, expectedEntryVersion.toString(), operation.kind];
  if (operation.kind === "rename") {
    signature.push(operation.title.trim());
  }
  if (operation.kind === "pin") {
    signature.push(String(operation.pinned));
  }
  return JSON.stringify(signature);
}
function manageBoard(repository, actorId2, command, now) {
  if (!validTarget(command)) {
    return rejection(command.commandId, "invalidCommand");
  }
  return execute(
    repository,
    actorId2,
    command.commandId,
    manageSignature(command),
    (writer2) => manage(writer2, actorId2, command, now)
  );
}
function uniqueTargets(targets) {
  if (targets.length === 0 || targets.length > maxPurgeTargets) {
    return void 0;
  }
  const byId = /* @__PURE__ */ new Map();
  for (const target2 of targets) {
    if (!validTarget(target2)) {
      return void 0;
    }
    const existing = byId.get(target2.boardId);
    if (existing && existing.expectedEntryVersion !== target2.expectedEntryVersion) {
      return void 0;
    }
    byId.set(target2.boardId, target2);
  }
  return [...byId.values()];
}
function purgeOne(writer2, actorId2, target2) {
  const { boardId } = target2;
  const managed = writer2.getManagedBoard(actorId2, boardId);
  if (!managed) {
    return { boardId, deleted: false, reason: "forbidden" };
  }
  const mismatch = targetMismatch(managed, target2, true);
  if (mismatch) {
    return { boardId, deleted: false, reason: mismatch };
  }
  writer2.deleteBoard(boardId);
  return { boardId, deleted: true };
}
function purgeSignature(targets) {
  const entries = targets.map(
    ({ boardId, expectedEntryVersion }) => JSON.stringify([boardId, expectedEntryVersion.toString()])
  );
  return JSON.stringify(["purge", entries.sort()]);
}
function purgeBoards(repository, actorId2, command) {
  const { commandId } = command;
  const targets = uniqueTargets(command.targets);
  if (!targets) {
    return rejection(commandId, "invalidCommand");
  }
  return execute(repository, actorId2, commandId, purgeSignature(targets), (writer2) => ({
    kind: "purged",
    commandId,
    items: targets.map((target2) => purgeOne(writer2, actorId2, target2))
  }));
}

// src/modules/catalog/application/index.ts
var maxQueryLength = 200;
var maxPageSize = 100;
var initialEntryVersion = 1n;
function catalogLookup(actor, request, view) {
  const { order, pageSize, cursor } = request;
  const query = request.query.trim();
  if (query.length > maxQueryLength) {
    throw new CatalogQueryError("The catalog search query is too long.");
  }
  if (order !== "recent" && order !== "title") {
    throw new CatalogQueryError("The catalog sort order is invalid.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new CatalogQueryError("The catalog page size is out of range.");
  }
  const scope2 = { actorId: actor.id, query, order, view };
  const after = cursor === void 0 ? void 0 : readCatalogCursor(cursor, scope2);
  return { ...scope2, limit: pageSize + 1, after };
}
function listBoards(repository, actor, request) {
  const { pageSize } = request;
  const lookup = catalogLookup(actor, request);
  const found = repository.listBoards(lookup);
  const boards = found.slice(0, pageSize);
  const lastBoard = boards.at(-1);
  const nextCursor = lastBoard && found.length > pageSize ? writeCatalogCursor(lookup, lastBoard) : void 0;
  return { boards, nextCursor };
}
function listTrashedBoards(repository, actor, request) {
  const { pageSize } = request;
  const lookup = catalogLookup(actor, request, "trash");
  const found = repository.listTrashedBoards(lookup);
  const boards = found.slice(0, pageSize);
  const lastBoard = boards.at(-1);
  const nextCursor = lastBoard && found.length > pageSize ? writeCatalogCursor(lookup, {
    ...lastBoard.board,
    trashedAtMillis: lastBoard.trashedAtMillis
  }) : void 0;
  return { boards, nextCursor };
}
function newBoard(services, commandId, title) {
  return {
    kind: "created",
    commandId,
    board: {
      boardId: services.newBoardId(),
      title,
      updatedAtMillis: catalogTimestamp(services.now()),
      pinned: false,
      entryVersion: initialEntryVersion,
      canManage: true
    }
  };
}
function createBoard(repository, services, actor, command) {
  const { commandId } = command;
  const title = normalizeBoardTitle(command.title);
  return repository.write((creation) => {
    const stored = creation.getReceipt(actor.id, commandId);
    if (stored) {
      const { receipt, duplicateSourceId } = stored;
      return duplicateSourceId === void 0 && receipt.kind === "created" && receipt.board.title === title ? receipt : { kind: "rejected", commandId, reason: "commandIdReuse" };
    }
    if (title === void 0) {
      return { kind: "rejected", commandId, reason: "invalidTitle" };
    }
    const created = newBoard(services, commandId, title);
    creation.saveBoard(actor.id, created);
    return created;
  });
}
function createCatalogApplication(repository, services) {
  return {
    listBoards: (actor, request) => listBoards(repository, actor, request),
    listTrashedBoards: (actor, request) => listTrashedBoards(repository, actor, request),
    createBoard: (actor, command) => createBoard(repository, services, actor, command),
    duplicateBoard: (actor, command) => duplicateBoard(
      repository,
      actor.id,
      command,
      (commandId, title) => newBoard(services, commandId, title)
    ),
    manageBoard: (actor, command) => manageBoard(repository, actor.id, command, services.now),
    purgeBoards: (actor, command) => purgeBoards(repository, actor.id, command),
    getReceipt: (actor, commandId) => repository.getReceipt(actor.id, commandId)
  };
}

// src/modules/feedback/application/errors.ts
var FeedbackAccessError = class extends Error {
  constructor() {
    super("This actor cannot access the requested feedback.");
  }
};
var FeedbackThreadNotFoundError = class extends Error {
  constructor() {
    super("Feedback thread was not found.");
  }
};
var FeedbackQueryError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// src/modules/feedback/application/access.ts
function permitsFeedback(access) {
  return access.canComment ?? access.canEdit;
}
function requireAccess(reader2, actor, boardId) {
  const access = reader2.getAccess(boardId, actor.id);
  if (!access) {
    throw new FeedbackAccessError();
  }
  return access;
}
function requireWriteAccess(reader2, actor, boardId) {
  const access = requireAccess(reader2, actor, boardId);
  if (!permitsFeedback(access)) {
    throw new FeedbackAccessError();
  }
  return access;
}
function canDeleteThread(actor, access, thread) {
  return permitsFeedback(access) && (access.isOwner || thread.first.authorActorId === actor.id);
}
function viewMessage(actor, access, message) {
  const authoredByViewer = message.authorActorId === actor.id;
  return { ...message, authoredByViewer, canEdit: permitsFeedback(access) && authoredByViewer };
}
function viewThread(actor, access, thread) {
  return {
    ...thread,
    first: viewMessage(actor, access, thread.first),
    canResolve: permitsFeedback(access),
    canDelete: canDeleteThread(actor, access, thread)
  };
}

// src/modules/feedback/domain/anchor.ts
var maximumBoardCoordinate = 1e9;
function validCoordinate(value) {
  return Number.isFinite(value) && Math.abs(value) <= maximumBoardCoordinate;
}
function validPoint(point) {
  return validCoordinate(point.x) && validCoordinate(point.y);
}
function inUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
function projectObjectPoint(object, u, v) {
  const radians = object.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const localX = (u - 0.5) * object.width;
  const localY = (v - 0.5) * object.height;
  return {
    x: object.x + object.width / 2 + localX * cos - localY * sin,
    y: object.y + object.height / 2 + localX * sin + localY * cos
  };
}
function freezeFeedbackAnchor(sourceBoardRevision, target2, object) {
  if (target2.kind === "board") {
    return validPoint(target2.point) ? { target: target2, sourceBoardRevision, frozenPoint: target2.point, targetMissing: false } : { kind: "rejected", reason: "invalidAnchor" };
  }
  if (!inUnitInterval(target2.u) || !inUnitInterval(target2.v)) {
    return { kind: "rejected", reason: "invalidAnchor" };
  }
  if (!object || object.objectId !== target2.objectId) {
    return { kind: "rejected", reason: "targetChanged" };
  }
  if (object.geometryVersion !== target2.geometryVersion) {
    return { kind: "rejected", reason: "targetChanged", currentVersion: object.geometryVersion };
  }
  const frozenPoint = projectObjectPoint(object, target2.u, target2.v);
  if (!validPoint(frozenPoint)) {
    return { kind: "rejected", reason: "invalidAnchor" };
  }
  const { kind, label, x, y, width, height, rotation } = object;
  return {
    target: target2,
    sourceBoardRevision,
    frozenPoint,
    frozenObject: { kind, label, x, y, width, height, rotation },
    targetMissing: false
  };
}

// src/modules/feedback/application/commands.ts
var maximumTextLength = 4e3;
function normalizedText(text2) {
  const content = text2.trim();
  const validLength = content.length <= maximumTextLength;
  return validLength && !content.includes("\0") ? content : "";
}
function timestamp(now, previous = 0n) {
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error("Feedback clock returned an invalid timestamp.");
  }
  const millis = BigInt(current);
  return millis > previous ? millis : previous;
}
function anchorSignature(target2) {
  if (target2.kind === "board") {
    return [target2.kind, String(target2.point.x), String(target2.point.y)];
  }
  return [
    target2.kind,
    target2.objectId,
    String(target2.u),
    String(target2.v),
    target2.geometryVersion.toString()
  ];
}
function commandSignature(operation) {
  switch (operation.kind) {
    case "create":
      return JSON.stringify([
        operation.kind,
        anchorSignature(operation.anchor),
        operation.text.trim()
      ]);
    case "reply":
      return JSON.stringify([operation.kind, operation.threadId, operation.text.trim()]);
    case "edit":
      return JSON.stringify([
        operation.kind,
        operation.threadId,
        operation.messageId,
        operation.expectedMessageVersion.toString(),
        operation.text.trim()
      ]);
    case "resolve":
    case "reopen":
    case "delete":
      return JSON.stringify([
        operation.kind,
        operation.threadId,
        operation.expectedThreadVersion.toString()
      ]);
  }
}
function makeMessage(context, messageId, text2, updatedAtMillis) {
  return {
    messageId,
    authorActorId: context.actor.id,
    text: text2,
    version: 1n,
    createdAtMillis: updatedAtMillis,
    updatedAtMillis
  };
}
function applied(thread, message) {
  return {
    kind: "applied",
    threadId: thread.threadId,
    threadVersion: thread.version,
    messageId: message?.messageId,
    messageVersion: message?.version,
    deleted: false
  };
}
function createThread(context, operation) {
  const text2 = normalizedText(operation.text);
  if (!text2) {
    return { kind: "rejected", reason: "invalidText" };
  }
  const { writer: writer2, boardId, now } = context;
  const target2 = operation.anchor;
  const object = target2.kind === "object" ? writer2.getObject(boardId, target2.objectId) : void 0;
  const anchor = freezeFeedbackAnchor(writer2.getBoardRevision(boardId), target2, object);
  if ("kind" in anchor) {
    return anchor;
  }
  const threadId = writer2.allocateId();
  const updatedAtMillis = timestamp(now);
  const first = makeMessage(context, threadId, text2, updatedAtMillis);
  const thread = {
    threadId,
    anchor,
    status: "open",
    first,
    updatedAtMillis,
    version: 1n,
    replyCount: 0
  };
  writer2.insertThread(boardId, thread);
  return applied(thread, first);
}
function replyToThread(context, thread, operation) {
  const text2 = normalizedText(operation.text);
  if (!text2) {
    return { kind: "rejected", reason: "invalidText" };
  }
  const { writer: writer2, boardId, now } = context;
  const updatedAtMillis = timestamp(now, thread.updatedAtMillis);
  const reply = makeMessage(context, writer2.allocateId(), text2, updatedAtMillis);
  const updated = {
    ...thread,
    status: "open",
    updatedAtMillis,
    version: thread.version + 1n,
    replyCount: thread.replyCount + 1
  };
  writer2.insertReply(boardId, thread.threadId, updated.replyCount, reply);
  writer2.updateThread(boardId, updated);
  return applied(updated, reply);
}
function editMessage(context, thread, operation) {
  const { actor, writer: writer2, boardId, now } = context;
  const previous = writer2.getMessage(boardId, thread.threadId, operation.messageId);
  if (!previous) {
    return { kind: "rejected", reason: "notFound" };
  }
  if (previous.authorActorId !== actor.id) {
    return { kind: "rejected", reason: "forbidden" };
  }
  if (previous.version !== operation.expectedMessageVersion) {
    return { kind: "rejected", reason: "versionChanged", currentVersion: previous.version };
  }
  const text2 = normalizedText(operation.text);
  if (!text2) {
    return { kind: "rejected", reason: "invalidText" };
  }
  if (text2 === previous.text) {
    return applied(thread, previous);
  }
  const updatedAtMillis = timestamp(now, thread.updatedAtMillis);
  const message = { ...previous, text: text2, updatedAtMillis, version: previous.version + 1n };
  const updated = { ...thread, updatedAtMillis, version: thread.version + 1n };
  writer2.updateMessage(boardId, thread.threadId, message);
  writer2.updateThread(boardId, updated);
  return applied(updated, message);
}
function changeThread(context, thread, operation) {
  const { actor, access, writer: writer2, boardId, now } = context;
  if (operation.kind === "delete" && !canDeleteThread(actor, access, thread)) {
    return { kind: "rejected", reason: "forbidden" };
  }
  if (thread.version !== operation.expectedThreadVersion) {
    return { kind: "rejected", reason: "versionChanged", currentVersion: thread.version };
  }
  if (operation.kind === "delete") {
    writer2.deleteThread(boardId, thread.threadId);
    return { ...applied(thread), deleted: true };
  }
  const status = operation.kind === "resolve" ? "resolved" : "open";
  if (thread.status === status) {
    return applied(thread);
  }
  const updated = {
    ...thread,
    status,
    updatedAtMillis: timestamp(now, thread.updatedAtMillis),
    version: thread.version + 1n
  };
  writer2.updateThread(boardId, updated);
  return applied(updated);
}
function executeCommand(context, operation) {
  if (operation.kind === "create") {
    return createThread(context, operation);
  }
  const thread = context.writer.getThread(context.boardId, operation.threadId);
  if (!thread) {
    return { kind: "rejected", reason: "notFound" };
  }
  switch (operation.kind) {
    case "reply":
      return replyToThread(context, thread, operation);
    case "edit":
      return editMessage(context, thread, operation);
    case "delete":
    case "resolve":
    case "reopen":
      return changeThread(context, thread, operation);
  }
}
function applyFeedback(repository, services, actor, command) {
  const { boardId, commandId, operation } = command;
  return repository.write((writer2) => {
    const access = requireWriteAccess(writer2, actor, boardId);
    const signature = services.digest(commandSignature(operation));
    const previous = writer2.getReceipt(boardId, actor.id, commandId);
    if (previous) {
      if (previous.signature === signature) {
        return previous.receipt;
      }
      return { boardId, commandId, outcome: { kind: "rejected", reason: "commandIdReuse" } };
    }
    const outcome = executeCommand(
      { writer: writer2, actor, access, boardId, now: services.now },
      operation
    );
    const receipt = { boardId, commandId, outcome };
    writer2.saveReceipt(actor.id, { signature, receipt });
    return receipt;
  });
}

// src/modules/feedback/application/pagination.ts
var defaultPageSize = 20;
var maximumPageSize = 50;
var maximumReplyPosition = 4294967295;
var maximumSqliteInteger = 9223372036854775807n;
var threadPositionPattern = /^(0|[1-9][0-9]{0,18}):([a-f0-9]{32})$/u;
var replyPositionPattern = /^(?:0|[1-9][0-9]{0,9})$/u;
function pageLimit(pageSize) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 0) {
    throw new FeedbackQueryError("Feedback page size is invalid.");
  }
  return Math.min(maximumPageSize, pageSize || defaultPageSize);
}
function readThreadPosition(cursor) {
  if (cursor === void 0) {
    return void 0;
  }
  const match = threadPositionPattern.exec(cursor);
  if (!match) {
    throw new FeedbackQueryError("Feedback thread cursor is invalid.");
  }
  const [, time, threadId] = match;
  if (!time || !threadId) {
    throw new FeedbackQueryError("Feedback thread cursor is invalid.");
  }
  const updatedAtMillis = BigInt(time);
  if (updatedAtMillis > maximumSqliteInteger) {
    throw new FeedbackQueryError("Feedback thread cursor is invalid.");
  }
  return { updatedAtMillis, threadId };
}
function writeThreadPosition(position) {
  return `${position.updatedAtMillis}:${position.threadId}`;
}
function readReplyPosition(cursor) {
  if (cursor === void 0) {
    return 0;
  }
  if (!replyPositionPattern.test(cursor)) {
    throw new FeedbackQueryError("Feedback reply cursor is invalid.");
  }
  const position = Number(cursor);
  if (position > maximumReplyPosition) {
    throw new FeedbackQueryError("Feedback reply cursor is invalid.");
  }
  return position;
}

// src/modules/feedback/application/index.ts
function createFeedbackApplication(repository, services) {
  return {
    listThreads: (actor, boardId, query) => repository.read((reader2) => {
      const access = requireAccess(reader2, actor, boardId);
      const { cursor, status, authorActorId } = query;
      const limit = pageLimit(query.pageSize);
      const position = readThreadPosition(cursor);
      const rows = reader2.listThreads({
        boardId,
        limit: limit + 1,
        position,
        status,
        authorActorId
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        threads: page.map((thread) => viewThread(actor, access, thread)),
        nextCursor: last && rows.length > limit ? writeThreadPosition(last) : void 0,
        canWrite: permitsFeedback(access)
      };
    }),
    getThread: (actor, boardId, threadId, query) => repository.read((reader2) => {
      const access = requireAccess(reader2, actor, boardId);
      const thread = reader2.getThread(boardId, threadId);
      if (!thread) {
        throw new FeedbackThreadNotFoundError();
      }
      const limit = pageLimit(query.pageSize);
      const position = readReplyPosition(query.cursor);
      const replies = reader2.listReplies(boardId, threadId, position, limit + 1);
      return {
        thread: viewThread(actor, access, thread),
        replies: replies.slice(0, limit).map((reply) => viewMessage(actor, access, reply)),
        nextCursor: replies.length > limit ? String(position + limit) : void 0,
        canWrite: permitsFeedback(access)
      };
    }),
    applyFeedback: (actor, command) => applyFeedback(repository, services, actor, command),
    getReceipt: (actor, boardId, commandId) => repository.read((reader2) => {
      requireWriteAccess(reader2, actor, boardId);
      return reader2.getReceipt(boardId, actor.id, commandId)?.receipt;
    })
  };
}

// src/modules/rooms/domain/presence.ts
var boardLimit = 1e7;
var maximumScreenDimension = 2e4;
var maximumZoom = 32;
var viewIdPattern = /^[A-Za-z0-9_-]{1,120}$/u;
function validViewId(id) {
  return viewIdPattern.test(id);
}
function withinWorld(value) {
  return Number.isFinite(value) && Math.abs(value) <= boardLimit;
}
function validCursor(point) {
  return point === void 0 || [point.x, point.y].every(withinWorld);
}
function validViewport(viewport) {
  if (!viewport) {
    return true;
  }
  const { centerX, centerY, zoom, width, height } = viewport;
  const center = [centerX, centerY].every(withinWorld);
  const magnification = Number.isFinite(zoom) && zoom >= 1e-3 && zoom <= maximumZoom;
  const dimensions = [width, height].every(
    (value) => Number.isFinite(value) && value > 0 && value <= maximumScreenDimension
  );
  return center && magnification && dimensions;
}
function validPresence(input) {
  const freshIdentity = validViewId(input.viewId) && input.sequence > 0n;
  return freshIdentity && validCursor(input.cursor) && validViewport(input.viewport);
}

// src/modules/rooms/domain/timer.ts
var defaultDuration = 3e5;
var minimumDuration = 1e3;
var maximumDuration = 5999e3;
var adjustStep = 6e4;
var endGraceMs = 2400;
var maximumVersion = (1n << 63n) - 1n;
var initialTimer = Object.freeze({
  version: 0n,
  durationMs: defaultDuration
});
function validDuration(milliseconds) {
  const inRange = milliseconds >= minimumDuration && milliseconds <= maximumDuration;
  return Number.isInteger(milliseconds) && inRange;
}
function timerView(state, now) {
  const { version, durationMs, deadlineUnixMs, pausedRemainingMs } = state;
  const base = { version, durationMs };
  if (pausedRemainingMs !== void 0) {
    return { ...base, phase: "paused", remainingMs: pausedRemainingMs };
  }
  if (deadlineUnixMs === void 0 || deadlineUnixMs + endGraceMs <= now) {
    return { ...base, phase: "idle", remainingMs: durationMs };
  }
  const remainingMs = Math.max(0, deadlineUnixMs - now);
  const phase = remainingMs > 0 ? "running" : "ended";
  return { ...base, phase, deadlineUnixMs, remainingMs };
}
function alterRemaining(state, current, now, delta) {
  if (delta !== adjustStep && delta !== -adjustStep) {
    return void 0;
  }
  const remaining = current.remainingMs + delta;
  if (!validDuration(remaining)) {
    return void 0;
  }
  if (current.phase === "running") {
    return { ...state, deadlineUnixMs: now + remaining };
  }
  if (current.phase === "paused") {
    return { ...state, pausedRemainingMs: remaining };
  }
  return { version: state.version, durationMs: remaining };
}
function transition(state, action, now) {
  const current = timerView(state, now);
  const initial = { version: state.version, durationMs: state.durationMs };
  switch (action.kind) {
    case "start": {
      const starting = current.phase === "idle" || current.phase === "ended";
      return starting ? { ...initial, deadlineUnixMs: now + state.durationMs } : void 0;
    }
    case "pause":
      return current.phase === "running" ? { ...initial, pausedRemainingMs: current.remainingMs } : void 0;
    case "resume":
      return current.phase === "paused" ? { ...initial, deadlineUnixMs: now + current.remainingMs } : void 0;
    case "reset":
      return initial;
    case "setDuration": {
      const allowed = current.phase !== "running" && validDuration(action.milliseconds);
      return allowed ? { ...initial, durationMs: action.milliseconds } : void 0;
    }
    case "adjustDuration":
      return alterRemaining(state, current, now, action.milliseconds);
  }
}
function changeTimer(current, action, now) {
  if (current.version >= maximumVersion) {
    return void 0;
  }
  const state = transition(current, action, now);
  return state && { ...state, version: current.version + 1n };
}

// src/modules/rooms/application/room-memory.ts
var maxParticipants = 64;
var maxPresenceSlots = 256;
var maxSubscriptions = 64;
var presenceTtlMs = 18e3;
var tombstoneTtlMs = 3e4;
var minimumUpdateGapMs = 40;
function peerKey({ actorId: actorId2, viewId }) {
  return JSON.stringify([actorId2, viewId]);
}
function absent(old, now, sequence2 = old.sequence) {
  return { key: old.key, sequence: sequence2, updatedAt: now, releaseAt: now + tombstoneTtlMs };
}
function acceptUpdate(previous, sequence2, now) {
  const throttled = previous.participant !== void 0 && now - previous.updatedAt < minimumUpdateGapMs;
  return previous.sequence < sequence2 && !throttled;
}
var RoomMemory = class {
  constructor(boardId, roomInstanceId, baselineRevision) {
    this.boardId = boardId;
    this.roomInstanceId = roomInstanceId;
    this.baselineRevision = baselineRevision;
  }
  boardId;
  roomInstanceId;
  slots = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  pending = [];
  delivering = false;
  sequence = 0n;
  baselineRevision;
  get active() {
    return this.listeners.size > 0 || this.slots.size > 0;
  }
  snapshot() {
    const participants = [];
    for (const slot of this.slots.values()) {
      if (slot.participant) {
        participants.push(slot.participant);
      }
    }
    return participants;
  }
  event(payload, now) {
    return {
      boardId: this.boardId,
      roomInstanceId: this.roomInstanceId,
      sequence: this.sequence,
      serverTimeUnixMs: now,
      payload
    };
  }
  publish(payload, now) {
    this.sequence++;
    this.pending.push(this.event(payload, now));
    if (this.delivering) {
      return;
    }
    this.delivering = true;
    try {
      for (const event of this.pending) {
        for (const listener2 of [...this.listeners]) {
          listener2.deliver(event);
        }
      }
    } finally {
      this.delivering = false;
      this.pending.length = 0;
    }
  }
  listen(listener2) {
    if (this.listeners.size >= maxSubscriptions) {
      return void 0;
    }
    this.listeners.add(listener2);
    return () => {
      this.listeners.delete(listener2);
    };
  }
  close() {
    for (const listener2 of [...this.listeners]) {
      listener2.close();
    }
    this.listeners.clear();
    this.slots.clear();
    this.pending.length = 0;
  }
  recheck() {
    for (const listener2 of [...this.listeners]) {
      listener2.recheck?.();
    }
  }
  change(changes, now) {
    this.publish({ kind: "participants", changes }, now);
  }
  sweep(now) {
    const removals = [];
    for (const [id, slot] of this.slots) {
      if (slot.participant) {
        if (slot.participant.expiresAtUnixMs <= now) {
          this.slots.set(id, absent(slot, now));
          removals.push(slot.key);
        }
      } else if (slot.releaseAt <= now) {
        this.slots.delete(id);
      }
    }
    if (removals.length) {
      this.change({ upserts: [], removals }, now);
    }
  }
  update(actorId2, input, access, now) {
    this.sweep(now);
    const key = { actorId: actorId2, viewId: input.viewId };
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (previous && !acceptUpdate(previous, input.sequence, now)) {
      return false;
    }
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }
    if (!previous?.participant && this.snapshot().length >= maxParticipants) {
      return false;
    }
    const participant = {
      key,
      displayName: access.displayName,
      role: access.role,
      sequence: input.sequence,
      expiresAtUnixMs: now + presenceTtlMs,
      cursor: input.cursor,
      viewport: input.viewport,
      following: input.following
    };
    this.slots.set(id, {
      key,
      sequence: participant.sequence,
      updatedAt: now,
      releaseAt: participant.expiresAtUnixMs + tombstoneTtlMs,
      participant
    });
    this.change({ upserts: [participant], removals: [] }, now);
    return true;
  }
  leave(key, sequence2, now) {
    this.sweep(now);
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (previous && previous.sequence >= sequence2) {
      return false;
    }
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }
    this.slots.set(id, { key, sequence: sequence2, updatedAt: now, releaseAt: now + tombstoneTtlMs });
    if (previous?.participant) {
      this.change({ upserts: [], removals: [key] }, now);
    }
    return true;
  }
  revoke(key, now) {
    const id = peerKey(key);
    const slot = this.slots.get(id);
    if (slot?.participant) {
      this.slots.set(id, absent(slot, now));
      this.change({ upserts: [], removals: [key] }, now);
    }
  }
};

// src/modules/rooms/application/timer-commands.ts
function rejected(key, reason) {
  return { changed: false, receipt: { ...key, outcome: { kind: "rejected", reason } } };
}
function executeTimerChange(repository, actorId2, command, now) {
  const { boardId, commandId, expectedVersion, action } = command;
  const key = { boardId, commandId };
  const signature = JSON.stringify([expectedVersion.toString(), action]);
  return repository.write((writer2) => {
    if (!writer2.access(boardId, actorId2)?.canEdit) {
      return rejected(key, "forbidden");
    }
    const stored = writer2.receipt(actorId2, key);
    if (stored) {
      return stored.signature === signature ? { changed: false, receipt: stored.receipt } : rejected(key, "commandIdReuse");
    }
    const current = writer2.timer(boardId) ?? initialTimer;
    if (current.version !== expectedVersion) {
      const outcome2 = { kind: "conflict", timer: timerView(current, now) };
      return { changed: false, receipt: { ...key, outcome: outcome2 } };
    }
    const next = changeTimer(current, action, now);
    if (!next) {
      return rejected(key, "invalidAction");
    }
    const outcome = { kind: "applied", timer: timerView(next, now) };
    const receipt = { ...key, outcome };
    writer2.saveTimer(boardId, next);
    writer2.saveReceipt(actorId2, { signature, receipt });
    return { changed: true, receipt };
  });
}

// src/modules/rooms/application/index.ts
var maxRooms = 128;
var maxChangedIds = 512;
var maxChangedMetadataBytes = 48 * 1024;
var RoomAccessError = class extends Error {
};
var RoomInputError = class extends Error {
};
var RoomCapacityError = class extends Error {
};
function requireAccess2(access) {
  if (!access) {
    throw new RoomAccessError("Room access is unavailable");
  }
  return access;
}
function limitedChange(change) {
  const {
    boardId,
    boardRevision,
    changedObjectIds = [],
    removedObjectIds = [],
    changedObjects = []
  } = change;
  const changedBytes = changedObjects.reduce((sum, value) => sum + value.byteLength, 0);
  const tooManyIds = changedObjectIds.length + removedObjectIds.length > maxChangedIds;
  const incomplete = changedObjectIds.length !== changedObjects.length;
  const tooLarge = changedBytes > maxChangedMetadataBytes || tooManyIds;
  const refreshScene = change.refreshScene || tooLarge || incomplete;
  return refreshScene ? { boardId, boardRevision, refreshScene: true } : { boardId, boardRevision, changedObjectIds, removedObjectIds, changedObjects };
}
function createRoomsApplication(repository, clock, instanceId) {
  const rooms = /* @__PURE__ */ new Map();
  let instances = 0;
  function roomFor(boardId, revision, now) {
    const existing = rooms.get(boardId);
    if (existing) {
      return existing;
    }
    if (rooms.size >= maxRooms) {
      for (const [id, room2] of rooms) {
        room2.sweep(now);
        if (!room2.active) {
          rooms.delete(id);
        }
      }
    }
    if (rooms.size >= maxRooms) {
      throw new RoomCapacityError("Too many active board rooms");
    }
    const room = new RoomMemory(boardId, instanceId + ":" + ++instances, revision);
    rooms.set(boardId, room);
    return room;
  }
  function access(boardId, actorId2) {
    return repository.read((reader2) => reader2.access(boardId, actorId2));
  }
  function readSnapshot(boardId, actorId2, now) {
    const stored = repository.read((reader2) => ({
      access: requireAccess2(reader2.access(boardId, actorId2)),
      timer: reader2.timer(boardId) ?? initialTimer
    }));
    const room = roomFor(boardId, stored.access.boardRevision, now);
    room.sweep(now);
    const event = room.event(
      {
        kind: "snapshot",
        snapshot: {
          actorId: actorId2,
          canEdit: stored.access.canEdit,
          boardRevision: stored.access.boardRevision,
          participants: room.snapshot(),
          timer: timerView(stored.timer, now)
        }
      },
      now
    );
    return { room, event, access: stored.access };
  }
  function publishContentChange(change) {
    const room = rooms.get(change.boardId);
    if (!room || change.boardRevision <= room.baselineRevision) {
      return;
    }
    room.baselineRevision = change.boardRevision;
    room.publish({ kind: "contentChanged", change: limitedChange(change) }, clock.nowMillis());
  }
  return {
    snapshot: (boardId, actorId2) => readSnapshot(boardId, actorId2, clock.nowMillis()).event,
    access,
    publishPresence(boardId, actorId2, input) {
      const authorized = requireAccess2(access(boardId, actorId2));
      if (!validPresence(input)) {
        throw new RoomInputError("Invalid room presence");
      }
      const now = clock.nowMillis();
      const room = roomFor(boardId, authorized.boardRevision, now);
      return room.update(actorId2, input, authorized, now);
    },
    leavePresence(boardId, key, sequence2) {
      const authorized = requireAccess2(access(boardId, key.actorId));
      if (!validViewId(key.viewId) || sequence2 <= 0n) {
        throw new RoomInputError("Invalid room presence identity");
      }
      const now = clock.nowMillis();
      return roomFor(boardId, authorized.boardRevision, now).leave(key, sequence2, now);
    },
    subscribe(boardId, key, listener2) {
      if (!validViewId(key.viewId)) {
        throw new RoomInputError("Invalid room presence identity");
      }
      const { room, event, access: access2 } = readSnapshot(boardId, key.actorId, clock.nowMillis());
      const release = room.listen(listener2);
      if (!release) {
        throw new RoomCapacityError("Too many room connections");
      }
      return { initial: event, access: access2, release };
    },
    tick(boardId, boardRevision) {
      rooms.get(boardId)?.sweep(clock.nowMillis());
      publishContentChange({ boardId, boardRevision, refreshScene: true });
    },
    notifyAccessChanged(boardId) {
      rooms.get(boardId)?.recheck();
    },
    revokeView(boardId, key) {
      rooms.get(boardId)?.revoke(key, clock.nowMillis());
    },
    changeTimer(actorId2, command) {
      const now = clock.nowMillis();
      const { changed, receipt } = executeTimerChange(repository, actorId2, command, now);
      if (changed && receipt.outcome.kind === "applied") {
        rooms.get(command.boardId)?.publish({ kind: "timer", timer: receipt.outcome.timer }, now);
      }
      return { receipt, serverTimeUnixMs: now };
    },
    timerReceipt(actorId2, key) {
      const receipt = repository.read((reader2) => {
        const current = requireAccess2(reader2.access(key.boardId, actorId2));
        return current.canEdit ? reader2.receipt(actorId2, key)?.receipt : void 0;
      });
      return { receipt, serverTimeUnixMs: clock.nowMillis() };
    },
    publishContentChange,
    close() {
      for (const room of rooms.values()) {
        room.close();
      }
      rooms.clear();
    }
  };
}

// src/modules/whiteboard/domain/section.ts
var radiansPerDegree = Math.PI / 180;
var degreesPerTurn = 360;
function rotationOf({ rotation }) {
  const angle = rotation % degreesPerTurn * radiansPerDegree;
  return { cosine: Math.cos(angle), sine: Math.sin(angle) };
}
function corners(geometry) {
  const { x, y, width, height } = geometry;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const { cosine, sine } = rotationOf(geometry);
  const offsets = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight }
  ];
  return offsets.map(({ x: dx, y: dy }) => ({
    x: x + halfWidth + dx * cosine - dy * sine,
    y: y + halfHeight + dx * sine + dy * cosine
  }));
}
function sectionContains(section, candidate) {
  const halfWidth = section.width / 2;
  const halfHeight = section.height / 2;
  const { cosine, sine } = rotationOf(section);
  const tolerance = Number.EPSILON * Math.max(halfWidth, halfHeight);
  return corners(candidate).every(({ x, y }) => {
    const dx = x - section.x - halfWidth;
    const dy = y - section.y - halfHeight;
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    return Math.abs(localX) <= halfWidth + tolerance && Math.abs(localY) <= halfHeight + tolerance;
  });
}

// src/modules/whiteboard/domain/export-scope.ts
var maxContainmentChecks = 1e6;
function indexByRelation(objects, field) {
  const index = /* @__PURE__ */ new Map();
  for (const object of objects) {
    const relation = object[field];
    if (relation === void 0) {
      continue;
    }
    const bucket = index.get(relation);
    if (bucket) {
      bucket.push(object);
    } else {
      index.set(relation, [object]);
    }
  }
  return index;
}
function addObjects(ids, objects) {
  for (const { objectId } of objects ?? []) {
    ids.add(objectId);
  }
}
function includeWithinSection(ids, objects, section) {
  for (const object of objects) {
    if (!ids.has(object.objectId) && sectionContains(section.geometry, object.geometry)) {
      ids.add(object.objectId);
    }
  }
}
function expandSelection(ids, objects, byId) {
  const byParent = indexByRelation(objects, "parentId");
  const byGroup = indexByRelation(objects, "groupId");
  const groups = /* @__PURE__ */ new Set();
  let checks = 0;
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      return { kind: "rejected", reason: "invalidSelection" };
    }
    addObjects(ids, byParent.get(id));
    if (entry.groupId !== void 0 && !groups.has(entry.groupId)) {
      groups.add(entry.groupId);
      addObjects(ids, byGroup.get(entry.groupId));
    }
    if (entry.kind === "section") {
      checks += objects.length;
      if (checks > maxContainmentChecks) {
        return { kind: "rejected", reason: "tooLarge" };
      }
      includeWithinSection(ids, objects, entry);
    }
  }
}
function selectExportObjects(objects, byId, scope2) {
  if (scope2.kind === "whole") {
    return objects;
  }
  if (scope2.objectIds.length === 0) {
    return { kind: "rejected", reason: "invalidSelection" };
  }
  const ids = new Set(scope2.objectIds);
  const expansionFailure = expandSelection(ids, objects, byId);
  if (expansionFailure) {
    return expansionFailure;
  }
  return objects.filter(({ objectId }) => ids.has(objectId));
}

// src/modules/whiteboard/domain/export-geometry.ts
var portOffsets = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
var maxCoordinate = 1e9;
var maxBends = 12;
var straightTolerance = 1;
function finitePoint({ x, y }) {
  return Math.abs(x) <= maxCoordinate && Math.abs(y) <= maxCoordinate;
}
function rotatePoint({ x, y }, rotation) {
  const angle = rotation % 360 * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}
function geometryCenter({ x, y, width, height }) {
  return { x: x + width / 2, y: y + height / 2 };
}
function geometryCorners(geometry) {
  const center = geometryCenter(geometry);
  const horizontal = geometry.width / 2;
  const vertical = geometry.height / 2;
  return [
    { x: -horizontal, y: -vertical },
    { x: horizontal, y: -vertical },
    { x: horizontal, y: vertical },
    { x: -horizontal, y: vertical }
  ].map((point) => {
    const rotated = rotatePoint(point, geometry.rotation);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  });
}
function target(endpoint2, geometry) {
  const { attachment, point } = endpoint2;
  const object = attachment && geometry.get(attachment.objectId);
  return { fallback: point, geometry: object?.geometry, port: attachment?.port };
}
function centerOf(entry) {
  return entry.geometry ? geometryCenter(entry.geometry) : entry.fallback;
}
function facingPort(geometry, other) {
  const center = geometryCenter(geometry);
  const local = rotatePoint({ x: other.x - center.x, y: other.y - center.y }, -geometry.rotation);
  if (Math.abs(local.x) > Math.abs(local.y)) {
    return local.x >= 0 ? "right" : "left";
  }
  return local.y >= 0 ? "bottom" : "top";
}
function resolveEnd(entry, other) {
  const { geometry } = entry;
  if (!geometry) {
    return { point: entry.fallback };
  }
  const offset = portOffsets[entry.port ?? facingPort(geometry, other)];
  const local = rotatePoint(
    { x: offset.x * geometry.width / 2, y: offset.y * geometry.height / 2 },
    geometry.rotation
  );
  const center = geometryCenter(geometry);
  const direction = rotatePoint(offset, geometry.rotation);
  return {
    point: { x: center.x + local.x, y: center.y + local.y },
    horizontal: Math.abs(direction.x) >= Math.abs(direction.y)
  };
}
function step(point, coordinate, horizontal) {
  return horizontal ? { x: coordinate, y: point.y } : { x: point.x, y: coordinate };
}
function clearsEndpoint(entry, tip, neighbor) {
  if (!entry.geometry) {
    return true;
  }
  if (!neighbor) {
    return false;
  }
  const origin = centerOf(entry);
  return (neighbor.x - tip.x) * (tip.x - origin.x) + (neighbor.y - tip.y) * (tip.y - origin.y) > 0;
}
function relativeRoute(relative, from, to) {
  const { offsets } = relative;
  if (!offsets.length || offsets.length > maxBends || !offsets.every(Number.isFinite)) {
    return void 0;
  }
  const start = centerOf(from);
  const end = centerOf(to);
  const firstHorizontal = relative.firstAxis === "horizontal";
  const lastHorizontal = firstHorizontal === (offsets.length % 2 === 0);
  const split = Math.ceil(offsets.length / 2);
  const coordinates = offsets.map((offset, index) => {
    const center = index < split ? start : end;
    const horizontal = firstHorizontal === (index % 2 === 0);
    return offset + (horizontal ? center.x : center.y);
  });
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (first === void 0 || last === void 0) {
    return void 0;
  }
  const tip = resolveEnd(from, step(start, first, firstHorizontal)).point;
  const destination = resolveEnd(to, step(end, last, !lastHorizontal)).point;
  const points = [tip];
  let cursor = tip;
  coordinates.forEach((coordinate, index) => {
    cursor = step(cursor, coordinate, firstHorizontal === (index % 2 === 0));
    points.push(cursor);
  });
  points.push(
    step(cursor, lastHorizontal ? destination.x : destination.y, lastHorizontal),
    destination
  );
  const clearsStart = clearsEndpoint(from, tip, points[1]);
  const clearsEnd = clearsEndpoint(to, destination, points.at(-2));
  const clearsTargets = clearsStart && clearsEnd;
  return clearsTargets && points.every(finitePoint) ? points : void 0;
}
function automaticRoute(start, end) {
  const from = start.point;
  const to = end.point;
  const horizontalDistance = Math.abs(to.x - from.x);
  const verticalDistance = Math.abs(to.y - from.y);
  if (horizontalDistance < straightTolerance || verticalDistance < straightTolerance) {
    return [from, to];
  }
  const horizontal = start.horizontal ?? end.horizontal ?? horizontalDistance >= verticalDistance;
  const middle = horizontal ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
  return [from, step(from, middle, horizontal), step(to, middle, horizontal), to];
}
function route(detail, from, to) {
  const relative = detail.relativeBends && relativeRoute(detail.relativeBends, from, to);
  if (relative) {
    return relative;
  }
  const start = resolveEnd(from, centerOf(to));
  const end = resolveEnd(to, centerOf(from));
  return detail.bends.length ? [start.point, ...detail.bends, end.point] : automaticRoute(start, end);
}
function exportConnector(detail, geometry) {
  const raw = route(detail, target(detail.start, geometry), target(detail.end, geometry));
  const points = raw.filter((point, index) => {
    const previous = raw[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  const middle = Math.floor((points.length - 1) / 2);
  const first = points[middle];
  if (!first || !points.every(finitePoint)) {
    return void 0;
  }
  const second = points[middle + 1] ?? first;
  const label = {
    x: (first.x + second.x) / 2 + (detail.labelOffset?.x ?? 0),
    y: (first.y + second.y) / 2 + (detail.labelOffset?.y ?? 0)
  };
  return finitePoint(label) ? { points, label } : void 0;
}

// src/modules/whiteboard/domain/export-svg-shapes.ts
var palette = /* @__PURE__ */ new Map([
  ["paper", "#f5f5f5"],
  ["paper-2", "#ececec"],
  ["ink", "#2d3142"],
  ["muted", "#4f5d75"],
  ["accent", "#eb6c36"],
  ["link", "#2e5aa8"],
  ["soft", "#68738a"],
  ["rule", "#bfc0c0"],
  ["ink-strong", "#111111"],
  ["white", "#ffffff"],
  ["black", "#000000"],
  ["transparent", "transparent"],
  ["yellow", "#f6e39c"],
  ["peach", "#f4c3a4"],
  ["pink", "#edbdd5"],
  ["green", "#bcd6be"],
  ["blue", "#b8d2ed"],
  ["purple", "#d0c0e5"],
  ["terracotta", "#b64e2a"],
  ["none", "none"]
]);
var colorLiteral = /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|rgba?\([-\d., %/]+\))$/iu;
var canvasTint = /^color-mix\(in srgb, *canvas (100|[1-9]?\d)%, *(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8}))\)$/iu;
var defaultStrokeWidth = 1.4;
var maximumStrokeWidth = 256;
function svgColor(value, fallback) {
  const color = value?.trim().toLowerCase() ?? "";
  const tint = canvasTint.exec(color);
  if (tint) {
    return `color-mix(in srgb, #f5f5f5 ${tint[1]}%, ${tint[2]})`;
  }
  return palette.get(color) ?? (colorLiteral.test(color) ? color : fallback);
}
function svgStrokeWidth(value, fallback = defaultStrokeWidth) {
  return value !== void 0 && value >= 0 && value <= maximumStrokeWidth ? value : fallback;
}
function databaseShape(width, height) {
  const top = Math.min(18, height / 4);
  const lower = height - top;
  const rim = top * 4 / 3;
  return `<path d="M 0 ${top} C 0 ${top - rim} ${width} ${top - rim} ${width} ${top} V ${lower} C ${width} ${lower + rim} 0 ${lower + rim} 0 ${lower} Z M 0 ${top} C 0 ${top + rim} ${width} ${top + rim} ${width} ${top}"/>`;
}
function documentShape(width, height) {
  const fold = Math.min(15, height / 3);
  return `<path d="M 0 0 H ${width} V ${height - fold} Q ${width * 0.75} ${height - fold * 2} ${width / 2} ${height - fold} Q ${width * 0.25} ${height + fold / 3} 0 ${height - fold} Z"/>`;
}
function personShape(width, height) {
  const radius = Math.min(width * 0.19, height * 0.16);
  const center = width / 2;
  const y = height * 0.17;
  const left = width * 0.12;
  const right = width - left;
  const shoulder = height * 0.55;
  return `<circle cx="${center}" cy="${y}" r="${radius}"/><path d="M ${left} ${height} V ${shoulder} C ${left} ${height * 0.3} ${right} ${height * 0.3} ${right} ${shoulder} V ${height} Z"/>`;
}
function cloudShape(width, height) {
  const edge = height * 0.8;
  return `<path d="M ${width * 0.2} ${edge} C ${width * -0.08} ${edge} ${width * -0.03} ${height * 0.25} ${width * 0.25} ${height * 0.28} C ${width * 0.27} ${height * -0.03} ${width * 0.7} ${height * -0.03} ${width * 0.75} ${height * 0.3} C ${width * 1.07} ${height * 0.25} ${width * 1.09} ${edge} ${width * 0.8} ${edge} Z"/>`;
}
function shapeOutline(shape, width, height) {
  switch (shape) {
    case "rect":
      return `<rect width="${width}" height="${height}"/>`;
    case "rounded":
      return `<rect width="${width}" height="${height}" rx="${Math.min(7, width / 2, height / 2)}"/>`;
    case "pill":
      return `<rect width="${width}" height="${height}" rx="${Math.min(width, height) / 2}"/>`;
    case "ellipse":
      return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"/>`;
    case "diamond":
      return `<path d="M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z"/>`;
    case "hexagon": {
      const inset = width * 0.18;
      return `<path d="M ${inset} 0 H ${width - inset} L ${width} ${height / 2} L ${width - inset} ${height} H ${inset} L 0 ${height / 2} Z"/>`;
    }
    case "parallelogram":
      return `<path d="M ${width * 0.18} 0 H ${width} L ${width * 0.82} ${height} H 0 Z"/>`;
    case "database":
      return databaseShape(width, height);
    case "queue": {
      const inset = Math.min(14, width / 3);
      return `<rect width="${width}" height="${height}"/><path d="M ${inset} 0 V ${height} M ${width - inset} 0 V ${height}" fill="none"/>`;
    }
    case "document":
      return documentShape(width, height);
    case "person":
      return personShape(width, height);
    case "cloud":
      return cloudShape(width, height);
    default:
      return void 0;
  }
}
function svgShape(shape, width, height, appearance2) {
  const outline = shapeOutline(shape, width, height);
  if (outline === void 0) {
    return void 0;
  }
  const fill = appearance2?.hollow ? "none" : svgColor(appearance2?.fill, "#ececec");
  const stroke = svgColor(appearance2?.stroke, "#68738a");
  const strokeWidth = svgStrokeWidth(appearance2?.strokeWidth);
  const dashed = appearance2?.dashed ? ' stroke-dasharray="6 5"' : "";
  return `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashed}>${outline}</g>`;
}

// src/modules/whiteboard/domain/export-svg-content.ts
var rasterMimeTypes = /* @__PURE__ */ new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp"
]);
var embeddedRaster = /^data:(image\/[A-Za-z]+);base64,([A-Za-z0-9+/]+={0,2})$/u;
var maxRows = 12;
var rowHeight = 20;
var xmlWhitespace = /* @__PURE__ */ new Set(["	", "\n", "\r"]);
function escapeXml(value) {
  return value.replace(
    new RegExp("\\p{Cc}", "gu"),
    (character) => character >= " " || xmlWhitespace.has(character) ? character : ""
  ).replace(/[\p{Cs}\ufffe\uffff]/gu, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
function bounded(value, minimum, maximum, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}
function lineText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return stringValue(record(value)?.text);
  }
  return value.map((run) => stringValue(record(run)?.text) || stringValue(run)).join("");
}
function documentRows(data, count) {
  const queue = Array.isArray(data.blocks) ? [...data.blocks] : [];
  const rows = [];
  for (let cursor = 0; cursor < queue.length && rows.length < count; cursor += 1) {
    const block = record(queue[cursor]);
    if (!block) {
      continue;
    }
    const text2 = lineText(block.content) || stringValue(record(block.props)?.caption);
    if (text2) {
      rows.push(text2);
    }
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        queue.push(child);
      }
    }
  }
  return rows;
}
function todoRows(data, count) {
  const items = Array.isArray(data.items) ? data.items : [];
  return items.slice(0, count).map((item) => {
    const row = record(item);
    const checked = row?.checked === true ? "\u2713" : "\u25A1";
    return checked + " " + stringValue(row?.text);
  });
}
function cellValue(cell2) {
  const data = record(cell2);
  if (typeof data?.number === "number") {
    return String(data.number);
  }
  if (typeof data?.boolValue === "boolean") {
    return String(data.boolValue);
  }
  return stringValue(data?.text);
}
function tableRows(data, count) {
  const rows = record(data.grid)?.rows;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.slice(0, count).map((row) => {
    const cells = record(row)?.cells;
    return Array.isArray(cells) ? cells.map(cellValue).join("  |  ") : "";
  });
}
function compactLines(label, width, fontSize, count) {
  const columns = Math.max(1, Math.floor(width / (fontSize * 0.67)));
  return label.split(/\r?\n/u).slice(0, count).map((line) => line.length > columns ? line.slice(0, columns) + "\u2026" : line);
}
function svgLabel(label, width, height, data, centered) {
  const fontSize = bounded(data.fontSize, 8, 72, 14);
  const fill = svgColor(stringValue(data.color), "#2d3142");
  const count = Math.max(1, Math.min(maxRows, Math.floor(height / rowHeight)));
  const lines = compactLines(label, width, fontSize, count);
  const right = data.align === "TEXT_ALIGNMENT_RIGHT";
  const center = centered || data.align === "TEXT_ALIGNMENT_CENTER";
  const alignedX = center ? width / 2 : 0;
  const x = right ? width : alignedX;
  const y = centered ? Math.max(fontSize, (height - lines.length * rowHeight) / 2 + fontSize) : fontSize;
  const alignedAnchor = center ? "middle" : "start";
  const anchor = right ? "end" : alignedAnchor;
  const body = lines.map((line) => `<tspan x="${x}" dy="${rowHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text y="${y - rowHeight}" font-size="${fontSize}" text-anchor="${anchor}" fill="${fill}">${body}</text>`;
}
function nativeCard(object, payload) {
  const { width, height } = object.geometry;
  const data = payload?.data ?? {};
  const count = Math.max(0, Math.min(maxRows, Math.floor((height - 40) / rowHeight)));
  let rows = [];
  if (object.kind === "document") {
    rows = documentRows(data, count);
  } else if (object.kind === "todo") {
    rows = todoRows(data, count);
  } else if (object.kind === "table") {
    rows = tableRows(data, count);
  }
  const text2 = [stringValue(data.title) || object.label, ...rows].join("\n");
  const fill = svgColor(object.appearance?.fill, object.kind === "note" ? "#f6e39c" : "#ffffff");
  const stroke = svgColor(object.appearance?.stroke, "#bfc0c0");
  const caption = svgLabel(text2, Math.max(0, width - 20), height, data, false);
  return `<rect width="${width}" height="${height}" rx="4" fill="${fill}" stroke="${stroke}"/><g transform="translate(10 8)">${caption}</g>`;
}
function rasterUri(source, assets) {
  if (typeof source !== "string") {
    return void 0;
  }
  const captured = assets.get(source);
  if (captured && rasterMimeTypes.has(captured.mimeType)) {
    return `data:${captured.mimeType};base64,${captured.base64}`;
  }
  const match = embeddedRaster.exec(source);
  return match?.[1] && rasterMimeTypes.has(match[1].toLowerCase()) ? source : void 0;
}
function imageExtent(width, height, data) {
  const crop = record(data.crop);
  if (!crop) {
    return { x: 0, y: 0, width, height, aspect: "xMidYMid meet" };
  }
  const zoom = bounded(crop.zoom, 1, 10, 1);
  const x = bounded(crop.x, 0, 1, 0.5);
  const y = bounded(crop.y, 0, 1, 0.5);
  const naturalSize2 = record(data.naturalSize);
  const naturalWidth = bounded(naturalSize2?.width, 0, 4294967295, 0);
  const naturalHeight = bounded(naturalSize2?.height, 0, 4294967295, 0);
  if (naturalWidth === 0 || naturalHeight === 0) {
    return {
      x: (1 - zoom) * width * x,
      y: (1 - zoom) * height * y,
      width: width * zoom,
      height: height * zoom,
      aspect: "xMidYMid slice"
    };
  }
  const scale = Math.max(width / naturalWidth, height / naturalHeight) * zoom;
  const scaledWidth = naturalWidth * scale;
  const scaledHeight = naturalHeight * scale;
  return {
    x: (width - scaledWidth) * x,
    y: (height - scaledHeight) * y,
    width: scaledWidth,
    height: scaledHeight,
    aspect: "none"
  };
}
function svgImage(object, data, assets) {
  const source = object.kind === "video" ? data.poster : data.src;
  if (!source) {
    return object.kind === "video" ? nativeCard(object, void 0) : void 0;
  }
  const uri = rasterUri(source, assets);
  if (!uri) {
    return void 0;
  }
  const { width, height } = object.geometry;
  const rect = imageExtent(width, height, data);
  return `<image x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="${rect.aspect}" href="${uri}"/>`;
}
function svgInk(object, data) {
  if (!Array.isArray(data.points)) {
    return void 0;
  }
  const { width, height } = object.geometry;
  const points = data.points.map((point) => {
    const entry = record(point);
    if (typeof entry?.x !== "number" || typeof entry.y !== "number") {
      return void 0;
    }
    return `${entry.x * width},${entry.y * height}`;
  });
  if (points.includes(void 0)) {
    return void 0;
  }
  const color = svgColor(object.appearance?.stroke, "#2d3142");
  const inkWidth = object.detail?.kind === "ink" ? object.detail.width : void 0;
  const strokeWidth = svgStrokeWidth(inkWidth ?? object.appearance?.strokeWidth, 3);
  return `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function svgContent(object, payload, assets) {
  const data = payload?.data ?? {};
  const { width, height } = object.geometry;
  switch (object.kind) {
    case "image":
    case "video":
      return svgImage(object, data, assets);
    case "ink":
      return svgInk(object, data);
    case "text":
    case "sticker":
      return svgLabel(stringValue(data.text) || object.label, width, height, data, false);
    case "document":
    case "todo":
    case "table":
    case "note":
    case "link":
      return nativeCard(object, payload);
    default:
      return void 0;
  }
}

// src/modules/whiteboard/domain/export-types.ts
var maxExportFileBytes = 32 * 1024 * 1024;

// src/modules/whiteboard/domain/export-svg.ts
var pad = 32;
function frameFrom(points) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}
function expandFrame(frame, points) {
  const bounds = frameFrom(points);
  if (!frame) {
    return bounds;
  }
  return {
    left: Math.min(frame.left, bounds.left),
    top: Math.min(frame.top, bounds.top),
    right: Math.max(frame.right, bounds.right),
    bottom: Math.max(frame.bottom, bounds.bottom)
  };
}
function arrowHead(head, tip, previous, stroke, width) {
  if (!tip || !previous) {
    return "";
  }
  if (!head || head === "none") {
    return "";
  }
  if (head === "circle") {
    return `<circle cx="${tip.x}" cy="${tip.y}" r="${2 * width}" fill="${stroke}"/>`;
  }
  const distance = Math.hypot(tip.x - previous.x, tip.y - previous.y);
  if (distance === 0) {
    return "";
  }
  const dx = (tip.x - previous.x) / distance;
  const dy = (tip.y - previous.y) / distance;
  const back = Math.min(distance, 5 * width);
  const side = 2.5 * width;
  const left = { x: tip.x - dx * back - dy * side, y: tip.y - dy * back + dx * side };
  const right = { x: tip.x - dx * back + dy * side, y: tip.y - dy * back - dx * side };
  return `<path d="M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z" fill="${stroke}"/>`;
}
function connectorMarkup(object, geometry) {
  const detail = object.detail;
  if (detail?.kind !== "connector") {
    return void 0;
  }
  const route2 = exportConnector(detail, geometry);
  if (!route2) {
    return void 0;
  }
  const { points, label } = route2;
  const coordinates = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const stroke = svgColor(object.appearance?.stroke, "#4f5d75");
  const width = svgStrokeWidth(object.appearance?.strokeWidth, 2);
  const dash = object.appearance?.dashed ? ' stroke-dasharray="6 5"' : "";
  const start = arrowHead(detail.startHead, points[0], points[1], stroke, width);
  const end = arrowHead(detail.endHead ?? "arrow", points.at(-1), points.at(-2), stroke, width);
  const caption = escapeXml(object.label);
  const text2 = caption ? `<text x="${label.x}" y="${label.y - 4}" text-anchor="middle" font-size="13" fill="#2d3142">${caption}</text>` : "";
  const line = `<polyline points="${coordinates}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${dash}/>`;
  return { value: line + start + end + text2, bounds: [...points, label] };
}
function sectionMarkup(object) {
  const transparent = object.detail?.kind === "section" && object.detail.transparent;
  const fill = transparent ? "none" : svgColor(object.appearance?.fill, "#ececec");
  const stroke = svgColor(object.appearance?.stroke, "#bfc0c0");
  const { width, height } = object.geometry;
  const caption = escapeXml(object.label);
  return `<rect width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-dasharray="6 5"/><text x="8" y="17" font-size="13" fill="#4f5d75">${caption}</text>`;
}
function objectMarkup(object, payload, assets) {
  if (object.kind === "section") {
    return sectionMarkup(object);
  }
  if (object.kind === "shape") {
    const { width, height } = object.geometry;
    const outline = object.detail?.kind === "shape" ? object.detail.outline : "rounded";
    const shape = svgShape(outline, width, height, object.appearance);
    const text2 = svgLabel(object.label, width, height, payload?.data ?? {}, true);
    return shape === void 0 ? void 0 : shape + text2;
  }
  return svgContent(object, payload, assets);
}
function positionedMarkup(object, index, snapshot, payload) {
  if (object.kind === "connector") {
    return connectorMarkup(object, snapshot.geometry);
  }
  const points = geometryCorners(object.geometry);
  if (!points.every(finitePoint)) {
    return void 0;
  }
  const markup = objectMarkup(object, payload, snapshot.assets);
  if (markup === void 0) {
    return void 0;
  }
  const { x, y, width, height, rotation } = object.geometry;
  const transform = `translate(${x} ${y}) rotate(${rotation % 360} ${width / 2} ${height / 2})`;
  const id = "board-object-" + index;
  const clip = object.kind === "image" || object.kind === "video" ? `<clipPath id="${id}"><rect width="${width}" height="${height}" rx="4"/></clipPath>` : `<clipPath id="${id}"><rect width="${width}" height="${height}"/></clipPath>`;
  const body = `<g clip-path="url(#${id})">${markup}</g>`;
  return { value: `<g transform="${transform}">${clip}${body}</g>`, bounds: points };
}
function svgDocument(snapshot, frame, body) {
  const x = (frame?.left ?? 0) - pad;
  const y = (frame?.top ?? 0) - pad;
  const width = (frame ? frame.right - frame.left : 1) + pad * 2;
  const height = (frame ? frame.bottom - frame.top : 1) + pad * 2;
  const title = escapeXml(snapshot.board.title);
  const revision = snapshot.board.revision.toString();
  const description = `\u767D\u677F\u7248\u672C ${revision}\uFF0C\u5305\u542B ${snapshot.objects.length} \u4E2A\u5BF9\u8C61\u3002`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" role="img" font-family="sans-serif"><title>${title}</title><desc>${description}</desc><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f5f5f5"/>${body}</svg>
`;
}
function renderExportSvg(snapshot) {
  const payloads = new Map(snapshot.payloads.map((payload) => [payload.objectId, payload]));
  const layers = [];
  let length = 0;
  let frame;
  for (const [index, object] of snapshot.objects.entries()) {
    const markup = positionedMarkup(object, index, snapshot, payloads.get(object.objectId));
    if (!markup) {
      return { kind: "rejected", reason: "unsupported" };
    }
    length += markup.value.length;
    if (length > maxExportFileBytes) {
      return { kind: "rejected", reason: "tooLarge" };
    }
    layers.push(markup.value);
    frame = expandFrame(frame, markup.bounds);
  }
  return svgDocument(snapshot, frame, layers.join(""));
}

// src/modules/whiteboard/domain/export-file.ts
var reservedFilename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
function filenameFor(title, format) {
  const name = Array.from(title).slice(0, 100).join("").replace(/[\p{Cc}<>:"/\\|?*]/gu, "-").trim().replace(/[. ]+$/u, "");
  const filename = reservedFilename.test(name) ? "\u767D\u677F-" + name : name || "\u767D\u677F";
  return filename + "." + format;
}
function isOutside(endpoint2, selected) {
  return endpoint2.attachment !== void 0 && !selected.has(endpoint2.attachment.objectId);
}
function standaloneObject(object, selected, geometry) {
  const { detail } = object;
  if (detail?.kind !== "connector") {
    return object;
  }
  const outsideStart = isOutside(detail.start, selected);
  const outsideEnd = isOutside(detail.end, selected);
  if (!outsideStart && !outsideEnd) {
    return object;
  }
  const route2 = exportConnector(detail, geometry);
  const startPoint = route2?.points[0] ?? detail.start.point;
  const endPoint = route2?.points.at(-1) ?? detail.end.point;
  return {
    ...object,
    detail: {
      ...detail,
      start: outsideStart ? { point: startPoint } : detail.start,
      end: outsideEnd ? { point: endPoint } : detail.end,
      bends: route2?.points.slice(1, -1) ?? detail.bends,
      relativeBends: void 0
    }
  };
}
function jsonExport(snapshot) {
  const selected = new Set(snapshot.objects.map(({ objectId }) => objectId));
  const assets = [...snapshot.assets].map(([source, asset]) => ({ source, ...asset }));
  const data = {
    schemaVersion: 1,
    board: snapshot.board,
    objects: snapshot.objects.map(
      (object) => standaloneObject(object, selected, snapshot.geometry)
    ),
    payloads: snapshot.payloads,
    assets
  };
  const json = JSON.stringify(
    data,
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  );
  return json + "\n";
}
function renderExportFile(snapshot, format) {
  const data = format === "svg" ? renderExportSvg(snapshot) : jsonExport(snapshot);
  if (typeof data !== "string") {
    return data;
  }
  const content = new TextEncoder().encode(data);
  if (content.byteLength > maxExportFileBytes) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  return {
    kind: "file",
    filename: filenameFor(snapshot.board.title, format),
    mimeType: format === "svg" ? "image/svg+xml" : "application/json",
    revision: snapshot.board.revision,
    content
  };
}

// src/modules/whiteboard/domain/movement.ts
var maxStoredVersion = (1n << 63n) - 1n;
function validVersion(version) {
  return version >= 0n && version <= maxStoredVersion;
}
function canAdvanceVersion(version) {
  return validVersion(version) && version < maxStoredVersion;
}
function commandSignature2({ delta, targets }) {
  const targetKeys = targets.map(
    ({ objectId, expectedGeometryVersion }) => JSON.stringify([objectId, expectedGeometryVersion.toString()])
  );
  return JSON.stringify([delta.dx.toString(), delta.dy.toString(), targetKeys.sort()]);
}
function hasValidMoveInput({ commandId, delta, targets }) {
  if (!commandId.trim() || !targets.length) {
    return false;
  }
  if (![delta.dx, delta.dy].every(Number.isFinite) || delta.dx === 0 && delta.dy === 0) {
    return false;
  }
  const ids = /* @__PURE__ */ new Set();
  for (const { objectId, expectedGeometryVersion } of targets) {
    if (!objectId.trim() || ids.has(objectId) || !validVersion(expectedGeometryVersion)) {
      return false;
    }
    ids.add(objectId);
  }
  return true;
}
function canTranslate({ detail }) {
  if (detail?.kind !== "connector") {
    return true;
  }
  return !detail.start.attachment || !detail.end.attachment || detail.bends.length > 0;
}
function translatePoint({ x, y }, { dx, dy }) {
  return { x: x + dx, y: y + dy };
}
function translateEndpoint(endpoint2, delta) {
  return endpoint2.attachment ? endpoint2 : { point: translatePoint(endpoint2.point, delta) };
}
function translateConnector(detail, delta) {
  const start = translateEndpoint(detail.start, delta);
  const end = translateEndpoint(detail.end, delta);
  const bends = detail.bends.map((point) => translatePoint(point, delta));
  if (![start.point, end.point, ...bends].every(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y)
  )) {
    return void 0;
  }
  return { ...detail, start, end, bends };
}
function hasFiniteGeometry({ x, y, width, height, rotation }) {
  const coordinates = [x, y, width, height, rotation, x + width, y + height];
  return coordinates.every(Number.isFinite) && Math.min(width, height) >= 0;
}
function translateObject(object, delta) {
  const geometry = { ...object.geometry, ...translatePoint(object.geometry, delta) };
  if (!hasFiniteGeometry(geometry) || !canAdvanceVersion(object.geometryVersion)) {
    return void 0;
  }
  const translated = { ...object, geometry, geometryVersion: object.geometryVersion + 1n };
  if (object.detail?.kind !== "connector") {
    return translated;
  }
  const detail = translateConnector(object.detail, delta);
  return detail && { ...translated, detail };
}

// src/modules/whiteboard/domain/payload.ts
var payloadKinds = /* @__PURE__ */ new Set([
  "text",
  "document",
  "embed",
  "todo",
  "table",
  "image",
  "video",
  "link",
  "sticker",
  "ink",
  "extension"
]);
function isSupportedPayload(bodyKind) {
  return payloadKinds.has(bodyKind);
}

// src/modules/whiteboard/domain/geometry-edits.ts
var worldLimit = 1e7;
var rotationLimit = 360;
var maximumLabelLength = 4096;
var maximumPaths = 64;
var maximumInkSamples = 2e4;
var minimumInkWidth = 0.1;
var maximumInkWidth = 100;
var shapes = /* @__PURE__ */ new Set([
  "rounded",
  "rect",
  "ellipse",
  "diamond",
  "pill",
  "hexagon",
  "parallelogram",
  "database",
  "queue",
  "document",
  "cloud",
  "person"
]);
var fixedOrientationKinds = /* @__PURE__ */ new Set([
  "section",
  "document",
  "todo",
  "table",
  "html",
  "diagram",
  "chart"
]);
var colorLiteral2 = /^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/iu;
function inWorld(value) {
  return Number.isFinite(value) && Math.abs(value) <= worldLimit;
}
function pointInWorld({ x, y }) {
  return inWorld(x) && inWorld(y);
}
function validGeometry({ x, y, width, height, rotation }) {
  return [x, y, width, height, x + width, y + height].every(inWorld) && width >= 0 && height >= 0 && Number.isFinite(rotation) && Math.abs(rotation) <= rotationLimit;
}
function validAppearance({ appearance: appearance2 }) {
  if (!appearance2) {
    return true;
  }
  const { fill, stroke, strokeWidth } = appearance2;
  return [fill, stroke].every((value) => value === void 0 || colorLiteral2.test(value)) && (strokeWidth === void 0 || strokeWidth >= 0 && strokeWidth <= maximumInkWidth);
}
function validInkWidth(width) {
  return width >= minimumInkWidth && width <= maximumInkWidth;
}
function hasValidEditInk(points) {
  return points.length > 0 && points.length <= maximumInkSamples && points.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
}
function connectorAttachmentIds(detail) {
  const { start, end } = detail;
  const ids = [start.attachment?.objectId, end.attachment?.objectId];
  return [...new Set(ids.filter((id) => id !== void 0))];
}
function validEndpoint({ point, attachment }) {
  return pointInWorld(point) && (!attachment || validNewObjectId(attachment.objectId));
}
function hasValidConnectorGeometry(detail) {
  const { start, end, bends, relativeBends, labelOffset } = detail;
  const validRelative = !relativeBends || relativeBends.offsets.length <= maximumPaths && relativeBends.offsets.every(inWorld);
  return validEndpoint(start) && validEndpoint(end) && bends.length <= maximumPaths && bends.every(pointInWorld) && validRelative && (!labelOffset || pointInWorld(labelOffset));
}
function validNewObjectId(id) {
  return id.length <= 160 && /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(id);
}
function validDetail({ kind, detail }) {
  switch (kind) {
    case "shape":
      return detail?.kind === "shape" && shapes.has(detail.outline);
    case "section":
      return detail?.kind === "section";
    case "ink":
      return detail?.kind === "ink" && validInkWidth(detail.width);
    case "connector":
      return detail?.kind === "connector" && hasValidConnectorGeometry(detail);
    default:
      return detail === void 0;
  }
}
function validateCreatedObject(object) {
  const { objectId, label, geometryVersion, payloadVersion, locked, groupId, geometry } = object;
  const validVersion2 = geometryVersion === 0n && (payloadVersion === void 0 || payloadVersion === 0n);
  const hasArea = object.kind === "connector" || geometry.width > 0 && geometry.height > 0;
  return validNewObjectId(objectId) && label.length <= maximumLabelLength && validVersion2 && !locked && groupId === void 0 && hasArea && validGeometry(geometry) && validAppearance(object) && validDetail(object);
}
function scaleInkWidth(width, before, after) {
  const scaleX = before.width > 0 ? after.width / before.width : 1;
  const scaleY = before.height > 0 ? after.height / before.height : 1;
  const averageScale = (scaleX + scaleY) / 2;
  return Math.min(maximumInkWidth, Math.max(minimumInkWidth, width * averageScale));
}
function nextDetail(object, { geometry, connector: connector2 }, transform) {
  if (transform === "connect") {
    return connector2;
  }
  const { detail } = object;
  if (transform === "resize" && detail?.kind === "ink") {
    return { ...detail, width: scaleInkWidth(detail.width, object.geometry, geometry) };
  }
  return detail;
}
function validTransformFields(object, { geometry, connector: connector2, ink }, transform) {
  const detailKind = object.detail?.kind;
  if (transform === "connect") {
    return detailKind === "connector" && connector2 !== void 0 && hasValidConnectorGeometry(connector2) && geometry.rotation === object.geometry.rotation && !ink;
  }
  if (connector2 || detailKind === "connector") {
    return false;
  }
  const invalidPoints = ink !== void 0 && ink.length > 0 && !hasValidEditInk(ink);
  if (ink && (detailKind !== "ink" || invalidPoints)) {
    return false;
  }
  const previous = object.geometry;
  if (transform === "resize") {
    return geometry.rotation === previous.rotation && geometry.width > 0 && geometry.height > 0;
  }
  return !fixedOrientationKinds.has(object.kind) && geometry.width === previous.width && geometry.height === previous.height;
}
function advanceGeometry(object, change, transform) {
  if (!canAdvanceVersion(object.geometryVersion) || !validGeometry(change.geometry) || !validTransformFields(object, change, transform)) {
    return void 0;
  }
  return {
    ...object,
    geometry: change.geometry,
    geometryVersion: object.geometryVersion + 1n,
    detail: nextDetail(object, change, transform)
  };
}
function geometryInWorld(geometry) {
  return validGeometry(geometry);
}

// src/modules/whiteboard/domain/object-content-edits.ts
var contentTitleLimit = 200;
var contentIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
var maximumContentBytes = 1024 * 1024;
var encoder = new TextEncoder();
function contentRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function contentFits(data) {
  const json = JSON.stringify(data);
  return json.length <= maximumContentBytes && encoder.encode(json).byteLength <= maximumContentBytes;
}

// src/modules/whiteboard/domain/object-content-edits-table.ts
var maxRows2 = 1e3;
var maxColumns = 256;
var maxCells = 2e4;
var maxAxisIdLength = 192;
var maxTableWidth = 1e7;
var widthTolerance = 1e-6;
var controlCharacter = new RegExp("\\p{Cc}", "u");
function validAxisId(value) {
  return typeof value === "string" && value.length <= maxAxisIdLength && Boolean(value.trim()) && !controlCharacter.test(value);
}
function validAxis(value, count) {
  if (!Array.isArray(value) || value.length !== count) {
    return false;
  }
  return value.every(validAxisId) && new Set(value).size === count;
}
function cellValueValid(raw) {
  const cell2 = contentRecord(raw);
  if (!cell2 || Object.keys(cell2).length !== 1) {
    return false;
  }
  if (typeof cell2.text === "string" || typeof cell2.boolValue === "boolean") {
    return true;
  }
  if (typeof cell2.number === "number") {
    return Number.isFinite(cell2.number);
  }
  return cell2.nullValue === null || cell2.nullValue === "NULL_VALUE";
}
function validRow(raw, columns) {
  const cells = contentRecord(raw)?.cells;
  return Array.isArray(cells) && cells.length === columns && cells.every(cellValueValid);
}
function validWidths(value, columns) {
  return Array.isArray(value) && value.length === columns && value.every((width) => typeof width === "number" && Number.isFinite(width) && width > 0);
}
function widthsAllowed(value, columns) {
  return value === void 0 || validWidths(value, columns) || Array.isArray(value) && value.length === 0;
}
function tableContentIssue(data) {
  const grid = contentRecord(data.grid);
  const rows = grid?.rows;
  const columns = Array.isArray(grid?.columnIds) ? grid.columnIds.length : 0;
  if (!grid || !Array.isArray(rows) || !rows.length) {
    return "invalidEdit";
  }
  if (rows.length > maxRows2 || columns > maxColumns || rows.length * columns > maxCells) {
    return "tooLarge";
  }
  const axes = columns > 0 && validAxis(grid.rowIds, rows.length) && validAxis(grid.columnIds, columns);
  const widths = widthsAllowed(grid.columnWidths, columns);
  const header = grid.head === void 0 || typeof grid.head === "boolean";
  if (!axes || !widths || !header) {
    return "invalidEdit";
  }
  if (data.text !== void 0 && typeof data.text !== "string") {
    return "invalidEdit";
  }
  if (!rows.every((row) => validRow(row, columns))) {
    return "invalidEdit";
  }
  if (!contentFits(data)) {
    return "tooLarge";
  }
}
function existingColumns(data, grid) {
  if (Array.isArray(grid?.rows) && grid.rows.length > 0) {
    return grid.rows.reduce((count, row) => {
      const cells = contentRecord(row)?.cells;
      return Array.isArray(cells) ? Math.max(count, cells.length) : count;
    }, 1);
  }
  if (typeof data.text === "string" && data.text) {
    return data.text.replace(/\r\n?/gu, "\n").replace(/\n$/u, "").split("\n").reduce((columns, row) => Math.max(columns, row.split("	").length), 1);
  }
  return 1;
}
function columnShares(widths) {
  const scale = widths.reduce((maximum, width) => Math.max(maximum, width), 0);
  const total = widths.reduce((sum, width) => sum + width / scale, 0);
  return widths.map((width) => width / scale / total);
}
function sharedColumnsResized(priorWidths, ids, widths) {
  const prior = [];
  const next = [];
  for (const [index, id] of ids.entries()) {
    const before = priorWidths.get(id);
    if (before !== void 0) {
      prior.push(before);
      next.push(widths[index] ?? 1);
    }
  }
  const oldShares = columnShares(prior);
  const newShares = columnShares(next);
  return newShares.some(
    (width, index) => Math.abs(width - (oldShares[index] ?? 0)) > widthTolerance
  );
}
function layoutChanges(objectId, current, next) {
  const before = contentRecord(current.grid);
  const after = contentRecord(next.grid);
  const columns = existingColumns(current, before);
  const rawIds = before?.columnIds;
  const priorIds = Array.isArray(rawIds) && validAxis(rawIds, columns) ? rawIds : Array.from({ length: columns }, (_, index) => objectId + ":col:" + index);
  const nextIds = Array.isArray(after?.columnIds) ? after.columnIds : [];
  const prior = before?.columnWidths;
  const updated = after?.columnWidths;
  const validPrior = validWidths(prior, columns) ? prior : [];
  const validUpdated = validWidths(updated, nextIds.length) ? updated : [];
  const priorById = new Map(priorIds.map((id, index) => [id, validPrior[index] ?? 1]));
  return {
    axesChanged: columns !== nextIds.length || nextIds.some((id, index) => priorIds[index] !== id),
    columnsResized: sharedColumnsResized(priorById, nextIds, validUpdated)
  };
}
function validWidth(width) {
  return Number.isFinite(width) && width > 0 && width <= maxTableWidth;
}
function editTableContent(object, current, { data, widthChange }) {
  const issue = tableContentIssue(data);
  if (issue) {
    return { kind: "rejected", reason: issue };
  }
  const { axesChanged, columnsResized } = layoutChanges(object.objectId, current, data);
  const changesLayout = axesChanged || columnsResized;
  if (widthChange && ![widthChange.width, widthChange.expectedWidth].every(validWidth)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  if (widthChange && widthChange.expectedWidth !== object.geometry.width) {
    return { kind: "conflict" };
  }
  if (changesLayout && !widthChange) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const width = widthChange?.width ?? object.geometry.width;
  const resizedFrame = width !== object.geometry.width;
  const geometryChanged = changesLayout || resizedFrame;
  const label = typeof data.text === "string" ? data.text : object.label;
  return {
    kind: "updated",
    label,
    data,
    geometryWidth: geometryChanged ? width : void 0,
    requiresGeometryUnlock: columnsResized || resizedFrame
  };
}

// src/modules/whiteboard/domain/geometry-edit-payloads.ts
var initialBodyKinds = /* @__PURE__ */ new Map([
  ["text", "text"],
  ["note", "text"],
  ["shape", "text"],
  ["section", "text"],
  ["connector", "text"],
  ["sticker", "sticker"],
  ["ink", "ink"],
  ["document", "document"],
  ["todo", "todo"],
  ["table", "table"],
  ["html", "embed"]
]);
var maxTextLength = 64 * 1024;
var maxTitleLength2 = 4096;
var maxStyleStringLength = 128;
var maxFontSize = 512;
var defaultTableRows = [
  ["\u540D\u79F0", "\u8BF4\u660E", "\u72B6\u6001"],
  ["\u9879\u76EE A", "\u53CC\u51FB\u7F16\u8F91\u8868\u683C", "\u8FDB\u884C\u4E2D"],
  ["\u9879\u76EE B", "\u5F85\u8865\u5145", "\u5F85\u5904\u7406"]
];
var defaultTableColumnCount = defaultTableRows[0].length;
var alignments = /* @__PURE__ */ new Set([
  "TEXT_ALIGNMENT_UNSPECIFIED",
  "TEXT_ALIGNMENT_LEFT",
  "TEXT_ALIGNMENT_CENTER",
  "TEXT_ALIGNMENT_RIGHT"
]);
function supportsGeometryCreation(kind) {
  return initialBodyKinds.has(kind);
}
function defaultTableData({ objectId, label, geometry }) {
  const rows = defaultTableRows.map((row) => ({ cells: row.map((text2) => ({ text: text2 })) }));
  const rowIds = rows.map((_row, index) => objectId + ":row:" + index);
  const columnIds = Array.from(
    { length: defaultTableColumnCount },
    (_, index) => objectId + ":col:" + index
  );
  const columnWidths = columnIds.map(() => geometry.width / defaultTableColumnCount);
  return { text: label, grid: { rows, rowIds, columnIds, columnWidths, head: true } };
}
function defaultInitialData(kind, object) {
  const { label } = object;
  switch (kind) {
    case "text":
      return { text: "" };
    case "sticker":
      return { stickerId: "heart" };
    case "ink":
      return void 0;
    case "document":
      return { title: label, schemaVersion: 1, blocks: [] };
    case "todo":
      return { title: label, items: [] };
    case "table":
      return defaultTableData(object);
  }
}
function optionalString(value, maximum) {
  return value === void 0 || typeof value === "string" && value.length <= maximum;
}
function emptyList(value) {
  return value === void 0 || Array.isArray(value) && value.length === 0;
}
function readInkPoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const { x = 0, y = 0 } = value;
  if (Object.keys(value).every((key) => key === "x" || key === "y")) {
    return typeof x === "number" && typeof y === "number" ? { x, y } : void 0;
  }
}
function validInkPoints(points) {
  if (!Array.isArray(points)) {
    return false;
  }
  const path2 = [];
  for (const value of points) {
    const point = readInkPoint(value);
    if (!point) {
      return false;
    }
    path2.push(point);
  }
  return hasValidEditInk(path2);
}
function validInitialText({ text: text2, color, fontFamily, fontSize, align }) {
  const validFont = fontSize === void 0 || typeof fontSize === "number" && fontSize > 0 && fontSize <= maxFontSize;
  return optionalString(text2, maxTextLength) && optionalString(color, maxStyleStringLength) && optionalString(fontFamily, maxStyleStringLength) && validFont && (align === void 0 || typeof align === "string" && alignments.has(align));
}
function validInitialData(kind, data) {
  switch (kind) {
    case "text":
      return validInitialText(data);
    case "sticker":
      return optionalString(data.stickerId, maxStyleStringLength) && optionalString(data.fallback, maxStyleStringLength);
    case "ink":
      return validInkPoints(data.points);
    case "document":
      return optionalString(data.title, maxTitleLength2) && data.schemaVersion === 1 && emptyList(data.blocks);
    case "todo":
      return optionalString(data.title, maxTitleLength2) && emptyList(data.items);
    case "table":
      return tableContentIssue(data) === void 0;
  }
}
function initialEmbedData({ label }, payload) {
  const { title, html, sourceRevision, state } = payload;
  const validTitle = label.length <= contentTitleLimit && (title === void 0 || title === label);
  const startsAtZero = sourceRevision === void 0 || sourceRevision === "0";
  if (!validTitle || !startsAtZero || state !== void 0) {
    return void 0;
  }
  if (typeof html !== "string" || !html.trim()) {
    return void 0;
  }
  const data = { title: label, html, sourceRevision: "0" };
  return contentFits(data) ? data : void 0;
}
function initialGeometryPayload(object, payload) {
  const bodyKind = initialBodyKinds.get(object.kind);
  if (!bodyKind) {
    return void 0;
  }
  const { objectId } = object;
  if (!payload) {
    const data = bodyKind === "embed" ? void 0 : defaultInitialData(bodyKind, object);
    return data && { objectId, bodyKind, payloadVersion: 0n, data };
  }
  if (payload.objectId !== objectId || payload.payloadVersion !== 0n || payload.bodyKind !== bodyKind) {
    return void 0;
  }
  if (bodyKind === "embed") {
    const data = initialEmbedData(object, payload.data);
    return data && { ...payload, data };
  }
  return validInitialData(bodyKind, payload.data) ? payload : void 0;
}

// src/modules/whiteboard/domain/object-content-edits-document.ts
var documentSchema = 1;
var maximumDepth = 64;
var maximumBlocks = 5e3;
var untitledDocument = "\u672A\u547D\u540D\u6587\u6863";
var assetPath = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
var localHost = /^(?:localhost$|.*\.localhost$|127\.|0\.0\.0\.0$|\[::(?:1|ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4})?\]$)/iu;
var blockTypes = /* @__PURE__ */ new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "table",
  "image",
  "divider"
]);
function knownImages(current) {
  const sources = /* @__PURE__ */ new Set();
  const pending = Array.isArray(current.blocks) ? [...current.blocks] : [];
  while (pending.length) {
    const block = contentRecord(pending.pop());
    const source = contentRecord(block?.props)?.url;
    if (block?.type === "image" && typeof source === "string") {
      sources.add(source);
    }
    if (Array.isArray(block?.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }
  return sources;
}
function preservedImage(source, known) {
  if (!known.has(source)) {
    return false;
  }
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/iu.test(source)) {
    return true;
  }
  const absolute = URL.parse(source);
  if (!absolute || !["http:", "https:"].includes(absolute.protocol)) {
    return false;
  }
  const hasCredentials = absolute.username !== "" || absolute.password !== "";
  const isHostLocal = localHost.test(absolute.hostname.replace(/\.$/u, ""));
  const isAssetRoute = absolute.pathname.startsWith("/studio-archive-assets/");
  return !hasCredentials && !isHostLocal && !isAssetRoute;
}
function validImage(source, assets, known) {
  if (source === void 0 || source === "") {
    return true;
  }
  if (typeof source !== "string") {
    return false;
  }
  const match = assetPath.exec(source);
  if (match) {
    const [, boardId, assetId] = match;
    return boardId === assets.boardId && assetId !== void 0 && assets.hasAsset(assetId);
  }
  return preservedImage(source, known);
}
function validBlock(block, assets, known) {
  const { type, children, props: rawProps } = block;
  const props = rawProps === void 0 ? {} : contentRecord(rawProps);
  const validType = typeof type === "string" && blockTypes.has(type);
  const validChildren = children === void 0 || Array.isArray(children);
  if (!validType || !props || !validChildren) {
    return false;
  }
  return type !== "image" || validImage(props.url, assets, known);
}
function checkBlocks(blocks, assets, known) {
  const pending = blocks.map((block) => ({ block, depth: 0 }));
  const ids = /* @__PURE__ */ new Set();
  while (pending.length) {
    if (pending.length + ids.size > maximumBlocks) {
      return "tooLarge";
    }
    const entry = pending.pop();
    if (!entry || entry.depth >= maximumDepth) {
      return "tooLarge";
    }
    const block = contentRecord(entry.block);
    const id = block?.blockId;
    const validId = typeof id === "string" && contentIdentifier.test(id);
    if (!block || !validId) {
      return "invalidEdit";
    }
    if (ids.has(id) || !validBlock(block, assets, known)) {
      return "invalidEdit";
    }
    ids.add(id);
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        pending.push({ block: child, depth: entry.depth + 1 });
      }
    }
  }
}
function editDocumentContent(data, current, assets) {
  const { title, schemaVersion, blocks } = data;
  if (typeof title !== "string" || schemaVersion !== documentSchema || !Array.isArray(blocks)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const label = title.trim() || untitledDocument;
  if (label.length > contentTitleLimit || !contentFits(data)) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const rejection3 = checkBlocks(blocks, assets, knownImages(current));
  if (rejection3) {
    return { kind: "rejected", reason: rejection3 };
  }
  return { kind: "updated", label, data: { title: label, schemaVersion, blocks } };
}

// src/modules/whiteboard/domain/object-content-edits-text.ts
var alignment = /* @__PURE__ */ new Set([
  "TEXT_ALIGNMENT_UNSPECIFIED",
  "TEXT_ALIGNMENT_LEFT",
  "TEXT_ALIGNMENT_CENTER",
  "TEXT_ALIGNMENT_RIGHT"
]);
var maxStyleLength = 256;
function validStyle(value) {
  return value === void 0 || typeof value === "string" && value.length <= maxStyleLength;
}
function validSize(value) {
  return value === void 0 || typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validAlignment(value) {
  return value === void 0 || typeof value === "string" && alignment.has(value);
}
function editTextContent(edit, current) {
  const { text: text2, color, fontFamily, fontSize, align } = edit;
  const validFormatting = validStyle(color) && validStyle(fontFamily) && validSize(fontSize);
  if (typeof text2 !== "string" || !validFormatting || !validAlignment(align)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const data = { ...current, ...edit };
  if (align === "TEXT_ALIGNMENT_UNSPECIFIED" && current.align !== void 0) {
    data.align = current.align;
  }
  if (!contentFits(data)) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  return { kind: "updated", label: text2, data };
}

// src/modules/whiteboard/domain/object-content-edits-todo.ts
var maxTodoItems = 200;
var maxTodoTextBytes = 2e3;
var untitledTodo = "\u4EFB\u52A1\u6E05\u5355";
var encoder2 = new TextEncoder();
function validText(text2) {
  return text2.length <= maxTodoTextBytes && encoder2.encode(text2).byteLength <= maxTodoTextBytes;
}
function sourceData(source) {
  const { boardId, objectId, blockId, itemId, version } = source;
  return {
    objectId,
    ...boardId === void 0 ? {} : { boardId },
    ...blockId === void 0 ? {} : { blockId },
    ...itemId === void 0 ? {} : { itemId },
    ...version === void 0 ? {} : { version }
  };
}
function rowData({ itemId, text: text2, checked, sourceRef }) {
  return {
    itemId,
    text: text2,
    checked,
    ...sourceRef === void 0 ? {} : { sourceRef: sourceData(sourceRef) }
  };
}
function readRows(value) {
  if (!Array.isArray(value) || value.length > maxTodoItems) {
    return;
  }
  const ids = /* @__PURE__ */ new Set();
  const rows = [];
  for (const raw of value) {
    const row = contentRecord(raw);
    const id = row?.itemId;
    const validId = typeof id === "string" && contentIdentifier.test(id);
    if (!row || !validId || ids.has(id)) {
      return;
    }
    if (typeof row.text !== "string" || typeof row.checked !== "boolean") {
      return;
    }
    ids.add(id);
    rows.push(row);
  }
  return { rows, usedIds: ids };
}
function rowPosition(rows, placement) {
  switch (placement.kind) {
    case "first":
      return 0;
    case "append":
      return rows.length;
    case "after": {
      const anchor = rows.findIndex(({ itemId }) => itemId === placement.itemId);
      return anchor < 0 ? -1 : anchor + 1;
    }
  }
}
function addRow(rows, usedIds, { item, placement }, canLink) {
  if (rows.length >= maxTodoItems || !validText(item.text)) {
    return "tooLarge";
  }
  const position = rowPosition(rows, placement);
  const newIdentifier = contentIdentifier.test(item.itemId) && !usedIds.has(item.itemId);
  const sourceAllowed = item.sourceRef === void 0 || canLink(item.sourceRef);
  if (position < 0 || !newIdentifier || !sourceAllowed) {
    return "invalidEdit";
  }
  rows.splice(position, 0, rowData(item));
  usedIds.add(item.itemId);
}
function updateRow(rows, index, change, canLink) {
  const { text: text2, checked, sourceRef } = change;
  if (text2 !== void 0 && !validText(text2)) {
    return "tooLarge";
  }
  if (sourceRef && !canLink(sourceRef)) {
    return "invalidEdit";
  }
  const next = { ...rows[index] };
  if (text2 !== void 0) {
    next.text = text2;
  }
  if (checked !== void 0) {
    next.checked = checked;
  }
  if (sourceRef === null) {
    delete next.sourceRef;
  } else if (sourceRef) {
    next.sourceRef = sourceData(sourceRef);
  }
  rows[index] = next;
}
function moveRow(rows, index, row, placement) {
  if (placement.kind === "after" && placement.itemId === row.itemId) {
    return "invalidEdit";
  }
  rows.splice(index, 1);
  const position = rowPosition(rows, placement);
  if (position < 0) {
    return "invalidEdit";
  }
  rows.splice(position, 0, row);
}
function applyRowEdit(rows, usedIds, change, canLink) {
  if (change.kind === "insert") {
    return addRow(rows, usedIds, change, canLink);
  }
  const index = rows.findIndex(({ itemId }) => itemId === change.itemId);
  const row = rows[index];
  if (!row) {
    return "invalidEdit";
  }
  switch (change.kind) {
    case "update":
      return updateRow(rows, index, change, canLink);
    case "delete":
      rows.splice(index, 1);
      return;
    case "move":
      return moveRow(rows, index, row, change.placement);
  }
}
function editTodoContent(current, edits, canLink) {
  if (edits.length > maxTodoItems) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const list = readRows(current.items ?? []);
  if (!list || !edits.length || typeof current.title !== "string") {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const { rows, usedIds } = list;
  let title = current.title;
  for (const edit of edits) {
    if (edit.kind === "rename") {
      title = edit.title.trim() || untitledTodo;
      if (title.length > contentTitleLimit) {
        return { kind: "rejected", reason: "tooLarge" };
      }
    } else {
      const reason = applyRowEdit(rows, usedIds, edit, canLink);
      if (reason) {
        return { kind: "rejected", reason };
      }
    }
  }
  const data = { title, items: rows };
  if (!contentFits(data)) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  return { kind: "updated", label: title, data };
}

// src/modules/whiteboard/domain/object-content-edits-embed.ts
var maxStateDepth = 16;
var maxStateBytes = 64 * 1024;
var sourceVersionPattern = /^(?:0|[1-9]\d{0,18})$/u;
var largestVersion = (1n << 63n) - 1n;
var encoder3 = new TextEncoder();
function embedSourceRevision({ data, payloadVersion }) {
  const saved = data.sourceRevision;
  if (saved === void 0) {
    return payloadVersion;
  }
  if (typeof saved === "number" && Number.isSafeInteger(saved) && saved >= 0) {
    return BigInt(saved);
  }
  if (typeof saved === "string" && sourceVersionPattern.test(saved)) {
    const revision = BigInt(saved);
    return revision <= largestVersion ? revision : void 0;
  }
}
function validStateLeaf(state, depth) {
  if (depth > maxStateDepth) {
    return false;
  }
  if (Array.isArray(state)) {
    return state.every((entry) => validStateLeaf(entry, depth + 1));
  }
  const record5 = contentRecord(state);
  if (record5) {
    return Object.values(record5).every((entry) => validStateLeaf(entry, depth + 1));
  }
  return typeof state !== "number" || Number.isFinite(state);
}
function persistSource(data, label) {
  return contentFits(data) ? { kind: "updated", data, label } : { kind: "rejected", reason: "tooLarge" };
}
function editEmbedSource(current, { title, html, expectedSourceRevision }) {
  const revision = embedSourceRevision(current);
  if (revision === void 0) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  if (revision !== expectedSourceRevision) {
    return { kind: "conflict" };
  }
  const sourceChanged = html !== (current.data.html ?? "");
  if (sourceChanged && !canAdvanceVersion(revision)) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  const label = title.trim() || "HTML \u56FE\u89E3";
  if (label.length > contentTitleLimit || html.length > 1024 * 1024) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const sourceRevision = (sourceChanged ? revision + 1n : revision).toString();
  return persistSource({ ...current.data, title: label, html, sourceRevision }, label);
}
function editEmbedState(current, label, state) {
  const revision = embedSourceRevision(current);
  if (revision === void 0) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  if (!contentRecord(state) || !validStateLeaf(state, 0)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const encoded = JSON.stringify(state);
  if (encoded.length > maxStateBytes || encoder3.encode(encoded).byteLength > maxStateBytes) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  return {
    kind: "updated",
    data: { ...current.data, state, sourceRevision: revision.toString() },
    label
  };
}

// src/modules/whiteboard/domain/object-content-edits-media.ts
var assetPath2 = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
var maxNaturalSize = 4294967295;
var maxCropZoom = 10;
var maxStickerFallbackLength = 64 * 1024;
var maxStickerLabelLength = 160;
var stickers = /* @__PURE__ */ new Map([
  ["smile", "\u7B11\u8138"],
  ["plus", "\u52A0\u53F7"],
  ["thumbs-up", "\u8D5E\u540C"],
  ["thumbs-down", "\u4E0D\u8D5E\u540C"],
  ["heart", "\u7231\u5FC3"],
  ["wave", "\u6325\u624B"],
  ["clap", "\u9F13\u638C"],
  ["handshake", "\u63E1\u624B"],
  ["heart-hand", "\u7528\u5FC3\u652F\u6301"],
  ["bulb", "\u60F3\u6CD5"],
  ["question", "\u95EE\u9898"],
  ["alert", "\u63D0\u9192"],
  ["check", "\u5B8C\u6210"],
  ["cross", "\u53D6\u6D88"],
  ["flag", "\u65D7\u5E1C"],
  ["bolt", "\u95EA\u7535"],
  ["pin", "\u5730\u70B9"],
  ["search", "\u53D1\u73B0"],
  ["key", "\u94A5\u5319"],
  ["party", "\u5E86\u795D"],
  ["trophy", "\u5956\u676F"],
  ["crown", "\u7687\u51A0"],
  ["gift", "\u793C\u7269"],
  ["clock", "\u65F6\u949F"],
  ["calendar", "\u65E5\u5386"],
  ["hourglass", "\u6C99\u6F0F"],
  ["messages", "\u8BA8\u8BBA"],
  ["megaphone", "\u516C\u544A"],
  ["pencil", "\u94C5\u7B14"],
  ["chart", "\u589E\u957F\u56FE\u8868"],
  ["trending-up", "\u5411\u4E0A\u8D8B\u52BF"],
  ["send", "\u7EB8\u98DE\u673A"],
  ["sun", "\u592A\u9633"],
  ["sprout", "\u840C\u82BD"],
  ["flower", "\u82B1\u6735"],
  ["coffee", "\u5496\u5561"],
  ["piggy-bank", "\u50A8\u84C4\u7F50"],
  ["arrow-right", "\u5411\u53F3"],
  ["arrow-up", "\u5411\u4E0A"],
  ["repeat", "\u5FAA\u73AF"],
  ["target", "\u76EE\u6807"],
  ["rocket", "\u706B\u7BAD"]
]);
function editStickerContent(current, selection) {
  if (selection.kind === "legacy") {
    const { fallback } = selection;
    const currentId = current.stickerId;
    const isGraphic = typeof currentId === "string" && stickers.has(currentId);
    if (isGraphic || fallback.length > maxStickerFallbackLength) {
      return { kind: "rejected", reason: "invalidEdit" };
    }
    const data = { ...current, fallback };
    delete data.stickerId;
    return { kind: "updated", label: fallback.trim().slice(0, maxStickerLabelLength), data };
  }
  const label = stickers.get(selection.id);
  if (!label) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  return { kind: "updated", label, data: { ...current, stickerId: selection.id } };
}
function hasLocalSource(src, assets) {
  if (typeof src !== "string") {
    return false;
  }
  const [, boardId, assetId] = assetPath2.exec(src) ?? [];
  return boardId === assets.boardId && assetId !== void 0 && assets.hasAsset(assetId);
}
function fittedCoordinate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
function naturalDimension(value) {
  return Number.isInteger(value) && value > 0 && value <= maxNaturalSize;
}
function priorZoom(current) {
  const zoom = contentRecord(current.crop)?.zoom;
  return typeof zoom === "number" && Number.isFinite(zoom) ? zoom : 0;
}
function editImageCrop(current, label, { crop, naturalSize: naturalSize2 }, assets) {
  const zoomInRange = Number.isFinite(crop.zoom) && crop.zoom >= 1 && crop.zoom <= Math.max(maxCropZoom, priorZoom(current));
  const offsetsInRange = fittedCoordinate(crop.x) && fittedCoordinate(crop.y);
  const validSize2 = [naturalSize2.width, naturalSize2.height].every(naturalDimension);
  if (!zoomInRange || !offsetsInRange || !validSize2) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  if (!hasLocalSource(current.src, assets)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const data = { ...current, crop: { ...crop }, naturalSize: { ...naturalSize2 } };
  return { kind: "updated", label, data };
}

// src/modules/whiteboard/domain/image-edits.ts
var assetIdPrefix = "image-";
var archiveAssetPath = "/studio-archive-assets/";
var pathSegment = /^[A-Za-z0-9_-]{1,128}$/u;
var unsafeName = new RegExp("[/\\\\]|\\p{Cc}|^[A-Za-z]:", "u");
var maximumDisplayName = 160;
var maximumImageBytes = 8 * 1024 * 1024;
var maximumDimension = 16384;
var maximumPixels = 32 * 1024 * 1024;
var pngSignatureStart = 2303741511;
var pngSignatureEnd = 218765834;
var pngHeaderSize = 13;
var pngHeaderOffset = 8;
var pngFirstDataOffset = 33;
var pngChunkOverhead = 12;
var pngBitDepths = /* @__PURE__ */ new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]]
]);
var jpegStart = 65496;
var jpegMarkerPrefix = 255;
var jpegEnd = 217;
var jpegScan = 218;
var jpegFrameMarkers = /* @__PURE__ */ new Set([192, 193, 194]);
var riffHeaderSize = 12;
var riffChunkHeaderSize = 8;
var vp8DimensionMask = 16383;
var vp8StartCode = 10289450;
var vp8HeaderSize = 10;
function fourCc(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}
function validDimensions({ width, height }) {
  const withinDimensions = [width, height].every(
    (dimension) => dimension > 0 && dimension <= maximumDimension
  );
  return withinDimensions && width * height <= maximumPixels;
}
function hasPngSignature(view) {
  return view.byteLength >= pngFirstDataOffset && view.getUint32(0) === pngSignatureStart && view.getUint32(4) === pngSignatureEnd;
}
function hasValidPngHeader(view) {
  if (view.getUint32(pngHeaderOffset) !== pngHeaderSize || fourCc(view, 12) !== "IHDR") {
    return false;
  }
  const depths = pngBitDepths.get(view.getUint8(25));
  const validMethods = view.getUint8(26) === 0 && view.getUint8(27) === 0;
  return Boolean(depths?.includes(view.getUint8(24)) && validMethods && view.getUint8(28) <= 1);
}
function hasCompletePngData(view) {
  let hasImageData = false;
  const needsPalette = view.getUint8(25) === 3;
  let hasPalette = false;
  let imageDataClosed = false;
  for (let offset = pngFirstDataOffset; offset + pngChunkOverhead <= view.byteLength; ) {
    const length = view.getUint32(offset);
    const type = fourCc(view, offset + 4);
    const end = offset + pngChunkOverhead + length;
    if (end > view.byteLength || type === "IHDR" || type === "acTL") {
      return false;
    }
    if (type === "IEND") {
      return hasImageData && length === 0 && end === view.byteLength;
    }
    if (type === "PLTE") {
      if (hasPalette || hasImageData || length === 0) {
        return false;
      }
      hasPalette = length <= 768 && length % 3 === 0;
      if (!hasPalette) {
        return false;
      }
    }
    if (type === "IDAT") {
      const paletteMissing = needsPalette && !hasPalette;
      if (imageDataClosed || paletteMissing) {
        return false;
      }
      hasImageData ||= length > 0;
    } else {
      imageDataClosed ||= hasImageData;
    }
    offset = end;
  }
  return false;
}
function readPngSize(view) {
  if (!hasValidPngHeader(view)) {
    return void 0;
  }
  const size = { width: view.getUint32(16), height: view.getUint32(20) };
  return validDimensions(size) && hasCompletePngData(view) ? size : void 0;
}
function jpegMarkerOffset(bytes, prefix) {
  let offset = prefix + 1;
  while (bytes[offset] === jpegMarkerPrefix) {
    offset += 1;
  }
  return offset;
}
function isRestartMarker(marker) {
  return marker >= 208 && marker <= 215;
}
function findJpegScanEnd(bytes, start) {
  let prefix = bytes.indexOf(jpegMarkerPrefix, start);
  while (prefix !== -1) {
    const offset = jpegMarkerOffset(bytes, prefix);
    const marker = bytes[offset];
    if (marker === void 0) {
      return -1;
    }
    if (marker !== 0 && !isRestartMarker(marker)) {
      return prefix;
    }
    prefix = bytes.indexOf(jpegMarkerPrefix, offset + 1);
  }
  return -1;
}
function readJpegFrame(view, segment, length) {
  if (length < 8 || view.getUint8(segment + 2) !== 8) {
    return void 0;
  }
  const components = view.getUint8(segment + 7);
  if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) {
    return void 0;
  }
  const size = { width: view.getUint16(segment + 5), height: view.getUint16(segment + 3) };
  return validDimensions(size) ? size : void 0;
}
function validJpegScanHeader(view, segment, length) {
  if (length < 6) {
    return false;
  }
  const components = view.getUint8(segment + 2);
  return components > 0 && components <= 4 && length === 6 + 2 * components;
}
function readJpegSize(view, bytes) {
  let size;
  let hasScan = false;
  for (let offset = 2; bytes[offset] === jpegMarkerPrefix; ) {
    const markerOffset = jpegMarkerOffset(bytes, offset);
    const marker = bytes[markerOffset];
    const segment = markerOffset + 1;
    if (marker === jpegEnd) {
      return hasScan && segment === view.byteLength ? size : void 0;
    }
    const markerOutOfRange = marker === void 0 || marker < 192 || marker === 216;
    if (markerOutOfRange || isRestartMarker(marker) || segment + 2 > view.byteLength) {
      return void 0;
    }
    const length = view.getUint16(segment);
    const end = segment + length;
    if (length < 2 || end > view.byteLength) {
      return void 0;
    }
    if (jpegFrameMarkers.has(marker)) {
      if (size) {
        return void 0;
      }
      size = readJpegFrame(view, segment, length);
      if (!size) {
        return void 0;
      }
    }
    if (marker !== jpegScan) {
      offset = end;
      continue;
    }
    if (!size || !validJpegScanHeader(view, segment, length)) {
      return void 0;
    }
    offset = findJpegScanEnd(bytes, end);
    if (offset <= end) {
      return void 0;
    }
    hasScan = true;
  }
  return void 0;
}
function uint24le(view, offset) {
  return view.getUint16(offset, true) + view.getUint8(offset + 2) * 65536;
}
function readWebpCanvas(view, offset, length) {
  if (length !== 10 || (view.getUint32(offset, true) & 4294967235) !== 0) {
    return void 0;
  }
  const width = uint24le(view, offset + 4) + 1;
  const height = uint24le(view, offset + 7) + 1;
  const size = { width, height };
  return validDimensions(size) ? size : void 0;
}
function readVp8Size(view, offset, length) {
  if (length <= vp8HeaderSize) {
    return void 0;
  }
  const frameTag = uint24le(view, offset);
  const partitionSize = frameTag >>> 5;
  const startCode = view.getUint32(offset + 2) & 16777215;
  const invalidPartition = partitionSize === 0 || partitionSize > length - vp8HeaderSize;
  if ((frameTag & 1) !== 0 || invalidPartition || startCode !== vp8StartCode) {
    return void 0;
  }
  return {
    width: view.getUint16(offset + 6, true) & vp8DimensionMask,
    height: view.getUint16(offset + 8, true) & vp8DimensionMask
  };
}
function readVp8LosslessSize(view, offset, length) {
  if (length <= 5 || view.getUint8(offset) !== 47) {
    return void 0;
  }
  const header = view.getUint32(offset + 1, true);
  if (header >>> 29 !== 0) {
    return void 0;
  }
  return {
    width: (header & vp8DimensionMask) + 1,
    height: (header >>> 14 & vp8DimensionMask) + 1
  };
}
function matchingSize(left, right) {
  return left.width === right.width && left.height === right.height;
}
function hasWebpSignature(view) {
  return view.byteLength >= riffHeaderSize && fourCc(view, 0) === "RIFF" && fourCc(view, 8) === "WEBP";
}
function readWebpChunk(view, offset) {
  const type = fourCc(view, offset);
  const length = view.getUint32(offset + 4, true);
  const start = offset + riffChunkHeaderSize;
  const end = start + length + length % 2;
  const animation = type === "ANIM" || type === "ANMF";
  if (end > view.byteLength || animation) {
    return void 0;
  }
  if (length % 2 === 1 && view.getUint8(end - 1) !== 0) {
    return void 0;
  }
  return { type, length, start, end };
}
function readWebpSize(view) {
  if (view.getUint32(4, true) !== view.byteLength - 8) {
    return void 0;
  }
  let canvas;
  let size;
  let offset = riffHeaderSize;
  while (offset + riffChunkHeaderSize <= view.byteLength) {
    const chunk = readWebpChunk(view, offset);
    if (!chunk) {
      return void 0;
    }
    const { type, length, start, end } = chunk;
    if (type === "VP8X") {
      canvas = readWebpCanvas(view, start, length);
      if (offset !== riffHeaderSize || !canvas) {
        return void 0;
      }
    } else if (type === "VP8 " || type === "VP8L") {
      if (size) {
        return void 0;
      }
      size = type === "VP8 " ? readVp8Size(view, start, length) : readVp8LosslessSize(view, start, length);
      if (!size || !validDimensions(size)) {
        return void 0;
      }
    } else if (!canvas) {
      return void 0;
    }
    offset = end;
  }
  if (offset !== view.byteLength || !size) {
    return void 0;
  }
  return !canvas || matchingSize(canvas, size) ? size : void 0;
}
function inspectImage(content) {
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  if (hasPngSignature(view)) {
    return { mimeType: "image/png", size: readPngSize(view) };
  }
  if (view.byteLength >= 2 && view.getUint16(0) === jpegStart) {
    return { mimeType: "image/jpeg", size: readJpegSize(view, content) };
  }
  if (hasWebpSignature(view)) {
    return { mimeType: "image/webp", size: readWebpSize(view) };
  }
  return void 0;
}
function validImagePlacement(boardId, assetId, operation) {
  const { objectId, displayName, geometry } = operation;
  const idsFitPath = [boardId, objectId, assetId].every((id) => pathSegment.test(id));
  const validName = displayName.length <= maximumDisplayName && !unsafeName.test(displayName);
  const positiveSize = geometry.width > 0 && geometry.height > 0;
  return idsFitPath && validName && positiveSize && geometryInWorld(geometry);
}
function planImageChanges(boardId, operation) {
  const { objectId, displayName, geometry, content } = operation;
  const assetId = assetIdPrefix + objectId;
  if (content.byteLength > maximumImageBytes) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  if (!validImagePlacement(boardId, assetId, operation)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const image = inspectImage(content);
  if (!image?.size) {
    return { kind: "rejected", reason: "invalidImage" };
  }
  return {
    kind: "changes",
    objects: [
      {
        objectId,
        kind: "image",
        label: displayName.trim() || "\u56FE\u7247",
        geometry,
        geometryVersion: 0n,
        payloadVersion: 0n,
        locked: false
      }
    ],
    payloads: [
      {
        objectId,
        bodyKind: "image",
        payloadVersion: 0n,
        data: {
          src: archiveAssetPath + boardId + "/" + assetId,
          naturalSize: { ...image.size }
        }
      }
    ],
    assets: [{ assetId, mimeType: image.mimeType, bytes: content }]
  };
}

// src/modules/whiteboard/domain/board-edits.ts
var boardWritePayloadLimit = 32n * 1024n * 1024n;

// src/modules/whiteboard/application/board-read.ts
var WhiteboardAccessError = class extends Error {
  constructor() {
    super("Whiteboard access denied");
    this.name = "WhiteboardAccessError";
  }
};
function requireAccess3(reader2, actor, boardId) {
  const access = reader2.getAccess(boardId, actor.id);
  if (!access) {
    throw new WhiteboardAccessError();
  }
  return access;
}
function payloadResult(objectId, payload) {
  if (!payload) {
    return { kind: "unavailable", objectId, reason: "notFound" };
  }
  if (!isSupportedPayload(payload.bodyKind)) {
    return { kind: "unavailable", objectId, reason: "unsupportedKind" };
  }
  return { kind: "payload", payload };
}

// src/modules/whiteboard/application/export-assets.ts
var maxAssetBytes = 20 * 1024 * 1024;
var assetPrefix = "/studio-archive-assets/";
var assetSource = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
var embeddedSource = /(?:\b(?:src|href|poster)\s*=\s*["']|\burl\(\s*["']?)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})(?=["'\s)])/gu;
function addAssetSource(sources, source) {
  if (typeof source === "string" && source.startsWith(assetPrefix)) {
    sources.add(source);
  }
}
function readObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function documentAssets(sources, blocks) {
  const pending = Array.isArray(blocks) ? [...blocks] : [];
  for (const entry of pending) {
    const block = readObject(entry);
    if (block?.type === "image") {
      addAssetSource(sources, readObject(block.props)?.url);
    }
    if (Array.isArray(block?.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }
}
function embedAssets(sources, markup) {
  if (typeof markup !== "string") {
    return;
  }
  for (const match of markup.matchAll(embeddedSource)) {
    const source = match[1];
    if (source) {
      sources.add(source);
    }
  }
}
function collectSources(payloads, format) {
  const sources = /* @__PURE__ */ new Set();
  for (const { bodyKind, data } of payloads) {
    switch (bodyKind) {
      case "image":
        addAssetSource(sources, data.src);
        break;
      case "video":
        addAssetSource(sources, data.poster);
        if (format === "json") {
          addAssetSource(sources, data.src);
        }
        break;
      case "document":
        if (format === "json") {
          documentAssets(sources, data.blocks);
        }
        break;
      case "embed":
        if (format === "json") {
          embedAssets(sources, data.html);
        }
    }
  }
  return sources;
}
function captureExportAssets(reader2, boardId, payloads, format) {
  const assets = /* @__PURE__ */ new Map();
  let remaining = maxAssetBytes;
  for (const source of collectSources(payloads, format)) {
    const match = assetSource.exec(source);
    const assetId = match?.[2];
    if (match?.[1] !== boardId || !assetId) {
      return { kind: "rejected", reason: "assetUnavailable" };
    }
    const result = reader2.getExportAsset?.(boardId, assetId, remaining);
    if (!result) {
      return { kind: "rejected", reason: "assetUnavailable" };
    }
    if (result.kind === "tooLarge" || result.asset.byteLength > remaining) {
      return { kind: "rejected", reason: "tooLarge" };
    }
    remaining -= result.asset.byteLength;
    assets.set(source, result.asset);
  }
  return assets;
}

// src/modules/whiteboard/application/export-board.ts
var maxExportObjects = 1e4;
var maxSnapshotObjects = 2e4;
var richSvgKinds = /* @__PURE__ */ new Set(["html", "diagram", "chart"]);
function captureSnapshot(reader2, command, board) {
  if (board.revision !== command.expectedRevision) {
    return { kind: "stale", revision: board.revision };
  }
  const objects = reader2.listObjects(command.boardId, maxSnapshotObjects + 1);
  if (objects.length > maxSnapshotObjects) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const geometry = new Map(objects.map((object) => [object.objectId, object]));
  const selected = selectExportObjects(objects, geometry, command.scope);
  if ("kind" in selected) {
    return selected;
  }
  if (selected.length > maxExportObjects) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  if (command.format === "svg" && selected.some(({ kind }) => richSvgKinds.has(kind))) {
    return { kind: "rejected", reason: "unsupported" };
  }
  const ids = selected.map(({ objectId }) => objectId);
  const rows = reader2.getPayloads(command.boardId, ids);
  const payloadById = new Map(rows.map((row) => [row.objectId, row]));
  const payloads = ids.flatMap((id) => payloadById.get(id) ?? []);
  const assets = captureExportAssets(reader2, command.boardId, payloads, command.format);
  if ("kind" in assets) {
    return assets;
  }
  return { board, objects: selected, geometry, payloads, assets };
}
function executeBoardExport(repository, actor, command, requireAccess4, readBoard3) {
  const snapshot = repository.read((reader2) => {
    requireAccess4(reader2, actor, command.boardId);
    return captureSnapshot(reader2, command, readBoard3(reader2));
  });
  if ("kind" in snapshot) {
    return snapshot;
  }
  const file = renderExportFile(snapshot, command.format);
  if (file.kind === "file") {
    repository.read((reader2) => requireAccess4(reader2, actor, command.boardId));
  }
  return file;
}

// src/modules/whiteboard/application/move-scope.ts
function ancestorsLocked(object, getObject2) {
  const visited = /* @__PURE__ */ new Set();
  let current = object;
  while (current && !visited.has(current.objectId)) {
    if (current.locked) {
      return true;
    }
    visited.add(current.objectId);
    current = current.parentId === void 0 ? void 0 : getObject2(current.parentId);
  }
  return false;
}
function collectObjects(initial, getRelated, isLocked2) {
  const pending = new Map(initial.map((object) => [object.objectId, object]));
  for (const object of pending.values()) {
    for (const candidate of getRelated(object)) {
      if (!pending.has(candidate.objectId) && !isLocked2(candidate)) {
        pending.set(candidate.objectId, candidate);
      }
    }
  }
  return [...pending.values()].filter(canTranslate);
}
function createMoveScope(writer2, boardId, targets) {
  const objectIds = targets.map(({ objectId }) => objectId);
  const cachedObjects = new Map(
    objectIds.map((id) => [id, void 0])
  );
  remember(writer2.getObjects(boardId, objectIds));
  const visitedGroups = /* @__PURE__ */ new Set();
  let scene;
  function remember(objects) {
    for (const object of objects) {
      cachedObjects.set(object.objectId, object);
    }
    return objects;
  }
  function getObject2(id) {
    if (!cachedObjects.has(id) && scene === void 0) {
      cachedObjects.set(id, writer2.getObjects(boardId, [id])[0]);
    }
    return cachedObjects.get(id);
  }
  function groupMembers(groupId) {
    if (groupId === void 0 || visitedGroups.has(groupId)) {
      return [];
    }
    visitedGroups.add(groupId);
    return remember(writer2.listGroupObjects(boardId, groupId));
  }
  function sectionMembers(object) {
    if (object.kind !== "section") {
      return [];
    }
    scene ??= remember(writer2.listObjects(boardId));
    return scene.filter((member) => sectionContains(object.geometry, member.geometry));
  }
  function getRelated(object) {
    const children = remember(writer2.listChildObjects(boardId, object.objectId));
    return [...children, ...groupMembers(object.groupId), ...sectionMembers(object)];
  }
  function isLocked2(object) {
    return ancestorsLocked(object, getObject2);
  }
  return {
    targets: new Map(objectIds.map((id) => [id, getObject2(id)])),
    isLocked: isLocked2,
    requiredObjects: (objects) => collectObjects(objects, getRelated, isLocked2)
  };
}

// src/modules/whiteboard/application/move-objects.ts
function receiptFor({ boardId, commandId }, outcome) {
  return { boardId, commandId, outcome };
}
function conflict(reason, boardRevision, currentObjects, missingObjectIds = []) {
  return { kind: "conflict", reason, boardRevision, currentObjects, missingObjectIds };
}
function translatedObjects(current, delta) {
  const translated = [];
  for (const object of current) {
    const next = translateObject(object, delta);
    if (!next) {
      return void 0;
    }
    translated.push(next);
  }
  return translated;
}
function applyMove(writer2, board, command, stamp) {
  const { boardId, revision } = board;
  const scope2 = createMoveScope(writer2, boardId, command.targets);
  const current = [];
  const missing = [];
  for (const [id, object] of scope2.targets) {
    if (!object) {
      missing.push(id);
      continue;
    }
    current.push(object);
  }
  if (missing.length) {
    return conflict("targetsChanged", revision, current, missing);
  }
  if (current.some((object) => scope2.isLocked(object))) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  const changed = command.targets.some(
    ({ objectId, expectedGeometryVersion }) => scope2.targets.get(objectId)?.geometryVersion !== expectedGeometryVersion
  );
  if (changed) {
    return conflict("geometryVersionChanged", revision, current);
  }
  if (!current.every(canTranslate) || !canAdvanceVersion(revision)) {
    return { kind: "rejected", reason: "invalidMove" };
  }
  const required = scope2.requiredObjects(current);
  if (required.length !== current.length) {
    return conflict("targetsChanged", revision, required);
  }
  const movingIds = current.map(({ objectId }) => objectId);
  const related = writer2.listRelatedConnectors?.(boardId, movingIds);
  if (related?.some((object) => scope2.isLocked(object))) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  const objects = translatedObjects(current, command.delta);
  if (!objects) {
    return { kind: "rejected", reason: "invalidMove" };
  }
  writer2.saveGeometry(boardId, objects);
  const commit = stamp && {
    ...stamp,
    kind: "geometry",
    changedObjectCount: objects.length
  };
  const boardRevision = writer2.advanceBoardRevision(boardId, commit);
  return { kind: "applied", boardRevision, objects };
}
function executeMove(writer2, actor, command, now) {
  const { boardId, commandId } = command;
  const access = writer2.getAccess(boardId, actor.id);
  const board = access && writer2.getBoard(boardId);
  if (!access || !board) {
    return receiptFor(command, { kind: "rejected", reason: "forbidden" });
  }
  const stored = writer2.getReceipt(boardId, actor.id, commandId);
  if (stored) {
    return stored.signature === commandSignature2(command) ? stored.receipt : receiptFor(command, { kind: "rejected", reason: "commandIdReuse" });
  }
  if (!access.canEdit) {
    return receiptFor(command, { kind: "rejected", reason: "forbidden" });
  }
  if (!hasValidMoveInput(command)) {
    return receiptFor(command, { kind: "rejected", reason: "invalidMove" });
  }
  const stamp = now && { actorId: actor.id, savedAtMillis: now() };
  const outcome = applyMove(writer2, board, command, stamp);
  const receipt = receiptFor(command, outcome);
  if (outcome.kind === "applied") {
    writer2.saveReceipt(actor.id, { signature: commandSignature2(command), receipt });
  }
  return receipt;
}

// src/modules/whiteboard/application/edit-content.ts
var stableId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
var sourceVersionPattern2 = /^(?:0|[1-9]\d{0,18})$/u;
var maxSourceVersion = (1n << 63n) - 1n;
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasBlock(blocks, blockId) {
  const pending = Array.isArray(blocks) ? [...blocks] : [];
  while (pending.length) {
    const block = pending.pop();
    if (!isRecord(block)) {
      continue;
    }
    if (block.blockId === blockId) {
      return true;
    }
    if (Array.isArray(block.children)) {
      for (const child of block.children) {
        pending.push(child);
      }
    }
  }
  return false;
}
function validSourceVersion(version) {
  return version === void 0 || sourceVersionPattern2.test(version) && BigInt(version) <= maxSourceVersion;
}
function optionalStableId(value) {
  return value === void 0 || stableId.test(value);
}
function resolveSourceLocation(writer2, boardId, { objectId, blockId, itemId }) {
  if (blockId === void 0 && itemId === void 0) {
    return writer2.getObjects(boardId, [objectId]).length === 1;
  }
  const [payload] = writer2.getPayloads(boardId, [objectId]);
  if (!payload) {
    return false;
  }
  if (blockId !== void 0) {
    return payload.bodyKind === "document" && hasBlock(payload.data.blocks, blockId);
  }
  const { items } = payload.data;
  return payload.bodyKind === "todo" && Array.isArray(items) && items.some((row) => isRecord(row) && row.itemId === itemId);
}
function validTodoSource(writer2, boardId, source) {
  const { boardId: owner, objectId, blockId, itemId, version } = source;
  const sameBoard = owner === void 0 || owner === boardId;
  const validIds = [objectId, blockId, itemId].every(optionalStableId);
  const unambiguous = blockId === void 0 || itemId === void 0;
  if (!sameBoard || !validIds || !unambiguous) {
    return false;
  }
  if (!validSourceVersion(version)) {
    return false;
  }
  return resolveSourceLocation(writer2, boardId, source);
}
function contentKinds(kind) {
  switch (kind) {
    case "embedSource":
    case "embedState":
      return { objectKind: "html", bodyKind: "embed" };
    case "crop":
      return { objectKind: "image", bodyKind: "image" };
    case "document":
    case "sticker":
    case "table":
    case "text":
    case "todo":
      return { objectKind: kind, bodyKind: kind };
  }
}
function objectTakesContent(kind, expected) {
  return kind === expected || kind === "note" && expected === "text";
}
function contentGeometryLocked(writer2, boardId, object) {
  const visited = /* @__PURE__ */ new Set();
  let candidate = object;
  while (candidate) {
    if (candidate.locked || visited.has(candidate.objectId)) {
      return true;
    }
    visited.add(candidate.objectId);
    const parentId = candidate.parentId;
    candidate = parentId === void 0 ? void 0 : writer2.getObjects(boardId, [parentId])[0];
  }
  return false;
}
function assetLookup(writer2, boardId) {
  const checked = /* @__PURE__ */ new Map();
  return (assetId) => {
    const current = checked.get(assetId);
    if (current !== void 0) {
      return current;
    }
    const found = writer2.getExportAsset?.(boardId, assetId, 0) !== void 0;
    checked.set(assetId, found);
    return found;
  };
}
function updatedPayload({ writer: writer2, boardId, object, current }, operation) {
  switch (operation.kind) {
    case "document":
      return editDocumentContent(operation.data, current.data, {
        boardId,
        hasAsset: assetLookup(writer2, boardId)
      });
    case "todo":
      return editTodoContent(
        current.data,
        operation.edits,
        (source) => validTodoSource(writer2, boardId, source)
      );
    case "text":
      return editTextContent(operation.data, current.data);
    case "table":
      return editTableContent(object, current.data, operation);
    case "embedSource":
      return editEmbedSource(current, operation);
    case "embedState":
      return editEmbedState(current, object.label, operation.state);
    case "sticker":
      return editStickerContent(current.data, operation.selection);
    case "crop":
      return editImageCrop(current.data, object.label, operation, {
        boardId,
        hasAsset: assetLookup(writer2, boardId)
      });
  }
}
function contentVersionConflict(board, object, current) {
  return {
    kind: "conflict",
    boardRevision: board.revision,
    objects: [object],
    payloads: [current]
  };
}
function withTableWidth({ writer: writer2, boardId, object }, width, requiresUnlock) {
  if (requiresUnlock && contentGeometryLocked(writer2, boardId, object)) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  if (!canAdvanceVersion(object.geometryVersion)) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  const geometry = { ...object.geometry, width };
  if (!geometryInWorld(geometry)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  return { ...object, geometry, geometryVersion: object.geometryVersion + 1n };
}
function planContentEdit(writer2, board, operation) {
  const { boardId } = board;
  const { objectId, expectedPayloadVersion } = operation;
  const [object] = writer2.getObjects(boardId, [objectId]);
  if (!object) {
    return { kind: "rejected", reason: "objectNotFound" };
  }
  const { objectKind, bodyKind } = contentKinds(operation.kind);
  if (!objectTakesContent(object.kind, objectKind)) {
    return { kind: "rejected", reason: "unsupportedKind" };
  }
  const [current] = writer2.getPayloads(boardId, [objectId]);
  if (!current || current.bodyKind !== bodyKind) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  if (current.payloadVersion !== expectedPayloadVersion) {
    return contentVersionConflict(board, object, current);
  }
  if (!canAdvanceVersion(current.payloadVersion) || !canAdvanceVersion(board.revision)) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  const editingIcon = operation.kind === "sticker" && operation.selection.kind === "icon";
  const needsUnlockedObject = editingIcon || operation.kind === "crop";
  if (needsUnlockedObject && contentGeometryLocked(writer2, boardId, object)) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  const scope2 = { writer: writer2, boardId, object, current };
  const planned = updatedPayload(scope2, operation);
  if (planned.kind === "rejected") {
    return planned;
  }
  if (planned.kind === "conflict") {
    return contentVersionConflict(board, object, current);
  }
  const revised = planned.geometryWidth === void 0 ? object : withTableWidth(scope2, planned.geometryWidth, Boolean(planned.requiresGeometryUnlock));
  if ("reason" in revised) {
    return revised;
  }
  const payloadVersion = current.payloadVersion + 1n;
  return {
    kind: "changes",
    objects: [{ ...revised, label: planned.label, payloadVersion }],
    payloads: [{ ...current, payloadVersion, data: planned.data }]
  };
}

// src/modules/whiteboard/application/edit-geometry.ts
var targetLimit = 512;
var derivedLimit = 2048;
function reject(reason) {
  return { kind: "rejected", reason };
}
function createGeometryScope(writer2, board) {
  const cache = /* @__PURE__ */ new Map();
  function objects(objectIds) {
    const found = writer2.getObjects(board.boardId, objectIds);
    for (const item of found) {
      cache.set(item.objectId, item);
    }
    return found;
  }
  function object(objectId) {
    if (!cache.has(objectId)) {
      cache.set(objectId, objects([objectId])[0]);
    }
    return cache.get(objectId);
  }
  return { board, writer: writer2, object, objects };
}
function isLocked(scope2, object) {
  const visited = /* @__PURE__ */ new Set();
  let current = object;
  while (current) {
    if (current.locked || visited.has(current.objectId)) {
      return true;
    }
    visited.add(current.objectId);
    current = current.parentId === void 0 ? void 0 : scope2.object(current.parentId);
  }
  return false;
}
function lockedParent(scope2, object) {
  return object.parentId !== void 0 && isLocked(scope2, scope2.object(object.parentId));
}
function conflict2(scope2, objects) {
  return { kind: "conflict", boardRevision: scope2.board.revision, objects };
}
function readTargets(scope2, targets) {
  if (targets.length === 0 || targets.length > targetLimit) {
    return reject(targets.length > targetLimit ? "tooLarge" : "invalidEdit");
  }
  const ids = new Set(targets.map(({ objectId }) => objectId));
  if (ids.size !== targets.length || targets.some(
    ({ objectId, expectedGeometryVersion }) => !objectId.trim() || expectedGeometryVersion < 0n
  )) {
    return reject("invalidEdit");
  }
  const objects = scope2.objects([...ids]);
  if (objects.length !== ids.size) {
    return conflict2(scope2, objects);
  }
  const versions = new Map(
    targets.map((target2) => [target2.objectId, target2.expectedGeometryVersion])
  );
  if (objects.some((object) => object.geometryVersion !== versions.get(object.objectId))) {
    return conflict2(scope2, objects);
  }
  return { kind: "targets", objects };
}
function checkAttachments(scope2, object, newIds) {
  const { detail, objectId } = object;
  if (detail?.kind !== "connector") {
    return void 0;
  }
  const ids = connectorAttachmentIds(detail);
  if (ids.includes(objectId)) {
    return reject("invalidEdit");
  }
  const existing = ids.filter((id) => !newIds?.has(id));
  if (existing.some((id) => scope2.object(id) === void 0)) {
    return reject("objectNotFound");
  }
}
function createObject(scope2, { object, payload }) {
  if (!supportsGeometryCreation(object.kind)) {
    return reject("unsupportedKind");
  }
  if (!validateCreatedObject(object) || scope2.writer.hasUsedObjectId(scope2.board.boardId, object.objectId)) {
    return reject("invalidEdit");
  }
  const parent = object.parentId === void 0 ? void 0 : scope2.object(object.parentId);
  if (object.parentId !== void 0 && parent?.kind !== "section") {
    return reject("objectNotFound");
  }
  if (isLocked(scope2, parent)) {
    return reject("geometryLocked");
  }
  const invalidAttachment = checkAttachments(scope2, object);
  if (invalidAttachment) {
    return invalidAttachment;
  }
  const body = initialGeometryPayload(object, payload);
  if (!body) {
    return reject("invalidEdit");
  }
  return {
    kind: "changes",
    objects: [{ ...object, payloadVersion: body.payloadVersion }],
    payloads: [body]
  };
}
function changeTransforms(scope2, operation, objects) {
  const { transform } = operation;
  if (objects.some((object) => isLocked(scope2, object))) {
    return reject("geometryLocked");
  }
  const existing = new Map(objects.map((object) => [object.objectId, object]));
  const changed = [];
  for (const change of operation.objects) {
    const object = existing.get(change.target.objectId);
    if (!object) {
      return reject("objectNotFound");
    }
    if (!canAdvanceVersion(object.geometryVersion)) {
      return reject("versionUnavailable");
    }
    const next = advanceGeometry(object, change, transform);
    if (!next) {
      return reject("invalidEdit");
    }
    const invalidAttachment = checkAttachments(scope2, next);
    if (invalidAttachment) {
      return invalidAttachment;
    }
    changed.push(next);
  }
  return { kind: "changes", objects: changed };
}
function transformObjects(scope2, operation) {
  const targets = readTargets(
    scope2,
    operation.objects.map(({ target: target2 }) => target2)
  );
  if (targets.kind !== "targets") {
    return targets;
  }
  const { writer: writer2, board } = scope2;
  const ids = targets.objects.map(({ objectId }) => objectId);
  const related = operation.transform === "connect" ? [] : writer2.listRelatedConnectors(board.boardId, ids);
  if (related.some((object) => isLocked(scope2, object))) {
    return reject("geometryLocked");
  }
  return changeTransforms(scope2, operation, targets.objects);
}
function changeLock(scope2, operation) {
  const targets = readTargets(scope2, operation.targets);
  if (targets.kind !== "targets") {
    return targets;
  }
  const objects = targets.objects.filter(({ locked }) => locked !== operation.locked);
  if (objects.length === 0) {
    return reject("invalidEdit");
  }
  if (objects.some((object) => lockedParent(scope2, object))) {
    return reject("geometryLocked");
  }
  if (objects.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))) {
    return reject("versionUnavailable");
  }
  return {
    kind: "changes",
    objects: objects.map((object) => ({
      ...object,
      locked: operation.locked,
      geometryVersion: object.geometryVersion + 1n
    }))
  };
}
function objectsRemovedByDeletion(scope2, targets) {
  const { writer: writer2, board } = scope2;
  const removed = new Map(targets.map((object) => [object.objectId, object]));
  let batch = [...removed.keys()];
  while (batch.length > 0) {
    const related = writer2.listRelatedConnectors(board.boardId, batch);
    batch = [];
    for (const connector2 of related) {
      if (!removed.has(connector2.objectId)) {
        removed.set(connector2.objectId, connector2);
        batch.push(connector2.objectId);
      }
    }
    if (removed.size > derivedLimit) {
      return void 0;
    }
  }
  return removed;
}
function detachedChildren(scope2, removed) {
  const children = [];
  for (const { objectId } of removed.values()) {
    for (const child of scope2.writer.listChildObjects(scope2.board.boardId, objectId)) {
      if (!removed.has(child.objectId)) {
        children.push(child);
      }
    }
  }
  return children;
}
function deleteObjects(scope2, operation) {
  const targets = readTargets(scope2, operation);
  if (targets.kind !== "targets") {
    return targets;
  }
  const removed = objectsRemovedByDeletion(scope2, targets.objects);
  if (!removed) {
    return reject("tooLarge");
  }
  const children = detachedChildren(scope2, removed);
  if (children.length + removed.size > derivedLimit) {
    return reject("tooLarge");
  }
  if ([...removed.values(), ...children].some((object) => isLocked(scope2, object))) {
    return reject("geometryLocked");
  }
  if (children.some(({ geometryVersion }) => !canAdvanceVersion(geometryVersion))) {
    return reject("versionUnavailable");
  }
  return {
    kind: "changes",
    removedObjectIds: [...removed.keys()],
    objects: children.map((child) => ({
      ...child,
      parentId: void 0,
      geometryVersion: child.geometryVersion + 1n
    }))
  };
}
function stepOrder(ids, selected, forward) {
  const changed = [...ids];
  const start = forward ? changed.length - 2 : 1;
  const end = forward ? -1 : changed.length;
  const step2 = forward ? -1 : 1;
  for (let index = start; index !== end && index >= 0; index += step2) {
    const neighbor = index - step2;
    const currentId = changed[index];
    const neighborId = changed[neighbor];
    const hasNeighbors = currentId !== void 0 && neighborId !== void 0;
    if (hasNeighbors && selected.has(currentId) && !selected.has(neighborId)) {
      changed[index] = neighborId;
      changed[neighbor] = currentId;
    }
  }
  return changed;
}
function reorder(ids, selected, direction) {
  if (direction === "forward" || direction === "backward") {
    return { order: stepOrder(ids, selected, direction === "forward") };
  }
  const moving = ids.filter((id) => selected.has(id));
  const remaining = ids.filter((id) => !selected.has(id));
  return {
    order: direction === "front" ? [...remaining, ...moving] : [...moving, ...remaining],
    layerPlacement: { position: direction, objectIds: moving }
  };
}
function reorderObjects(scope2, operation) {
  const targets = readTargets(scope2, operation.targets);
  if (targets.kind !== "targets") {
    return targets;
  }
  if (scope2.board.revision !== operation.expectedBoardRevision) {
    return conflict2(scope2, targets.objects);
  }
  if (targets.objects.some((object) => isLocked(scope2, object))) {
    return reject("geometryLocked");
  }
  const order = scope2.writer.listObjects(scope2.board.boardId).map(({ objectId }) => objectId);
  const selected = new Set(targets.objects.map(({ objectId }) => objectId));
  const next = reorder(order, selected, operation.direction);
  return next.order.some((id, index) => order[index] !== id) ? { kind: "changes", ...next } : reject("invalidEdit");
}
function copiedEndpoint(endpoint2, { ids, delta }) {
  if (!endpoint2.attachment) {
    return endpoint2;
  }
  const objectId = ids.get(endpoint2.attachment.objectId);
  if (!objectId) {
    return endpoint2;
  }
  return {
    point: { x: endpoint2.point.x + delta.dx, y: endpoint2.point.y + delta.dy },
    attachment: { ...endpoint2.attachment, objectId }
  };
}
function duplicateObject(source, objectId, duplicate) {
  const moved = translateObject({ ...source, geometryVersion: 0n }, duplicate.delta);
  if (!moved || !geometryInWorld(moved.geometry)) {
    return void 0;
  }
  const { detail } = moved;
  const copy = {
    ...moved,
    objectId,
    geometryVersion: 0n,
    payloadVersion: source.payloadVersion === void 0 ? void 0 : 0n,
    parentId: source.parentId === void 0 ? void 0 : duplicate.ids.get(source.parentId),
    groupId: source.groupId === void 0 ? void 0 : duplicate.groups.get(source.groupId)
  };
  if (detail?.kind !== "connector") {
    return copy;
  }
  const start = copiedEndpoint(detail.start, duplicate);
  const end = copiedEndpoint(detail.end, duplicate);
  const nextDetail2 = { ...detail, start, end };
  return hasValidConnectorGeometry(nextDetail2) ? { ...copy, detail: nextDetail2 } : void 0;
}
function duplicateGroups(scope2, sources, ids) {
  const groups = /* @__PURE__ */ new Map();
  for (const { objectId, groupId } of sources) {
    const replacement = ids.get(objectId);
    if (groupId === void 0 || !replacement || groups.has(groupId)) {
      continue;
    }
    const newGroupId = "group:" + replacement;
    if (scope2.writer.listGroupObjects(scope2.board.boardId, newGroupId).length > 0) {
      return void 0;
    }
    groups.set(groupId, newGroupId);
  }
  return groups;
}
function duplicatePayloads(scope2, sources, ids) {
  const bodies = scope2.writer.getPayloads(
    scope2.board.boardId,
    sources.map(({ objectId }) => objectId)
  );
  const byId = new Map(bodies.map((body) => [body.objectId, body]));
  const copied = [];
  for (const source of sources) {
    const body = byId.get(source.objectId);
    const objectId = ids.get(source.objectId);
    if (!body || !objectId || body.payloadVersion !== source.payloadVersion) {
      return void 0;
    }
    copied.push({ ...body, objectId, payloadVersion: 0n });
  }
  return copied;
}
function duplicateChanges(scope2, sources, duplicate) {
  const newIds = new Set(duplicate.ids.values());
  const objects = [];
  for (const source of sources) {
    const objectId = duplicate.ids.get(source.objectId);
    const next = objectId && duplicateObject(source, objectId, duplicate);
    if (!next) {
      return reject("invalidEdit");
    }
    const invalidAttachment = checkAttachments(scope2, next, newIds);
    if (invalidAttachment) {
      return invalidAttachment;
    }
    objects.push(next);
  }
  const sourcesWithPayload = sources.filter(({ payloadVersion }) => payloadVersion !== void 0);
  const payloadBytes = scope2.writer.payloadByteSize?.(
    scope2.board.boardId,
    sourcesWithPayload.map(({ objectId }) => objectId)
  );
  if (payloadBytes !== void 0 && payloadBytes > boardWritePayloadLimit) {
    return reject("tooLarge");
  }
  const payloads = duplicatePayloads(scope2, sourcesWithPayload, duplicate.ids);
  return payloads ? { kind: "changes", objects, payloads } : reject("objectNotFound");
}
function duplicateObjects(scope2, operation) {
  const targets = readTargets(
    scope2,
    operation.targets.map(({ source }) => source)
  );
  if (targets.kind !== "targets") {
    return targets;
  }
  const ids = new Map(
    operation.targets.map(({ source, newObjectId }) => [source.objectId, newObjectId])
  );
  const newIds = new Set(ids.values());
  if (newIds.size !== ids.size || [...newIds].some(
    (id) => !validNewObjectId(id) || scope2.writer.hasUsedObjectId(scope2.board.boardId, id)
  )) {
    return reject("invalidEdit");
  }
  const groups = duplicateGroups(scope2, targets.objects, ids);
  if (!groups) {
    return reject("invalidEdit");
  }
  return duplicateChanges(scope2, targets.objects, { ids, groups, delta: operation.delta });
}
function planGeometryEdit(writer2, board, operation) {
  const scope2 = createGeometryScope(writer2, board);
  switch (operation.kind) {
    case "create":
      return createObject(scope2, operation);
    case "transform":
      return transformObjects(scope2, operation);
    case "lock":
      return changeLock(scope2, operation);
    case "delete":
      return deleteObjects(scope2, operation.targets);
    case "reorder":
      return reorderObjects(scope2, operation);
    case "duplicate":
      return duplicateObjects(scope2, operation);
  }
}

// src/modules/whiteboard/application/board-suggestion-plans.ts
var BoardSuggestionError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "BoardSuggestionError";
  }
  status;
};
var proposalLifetimeMillis = 30n * 60000n;
var suggestionIdentifier = /^[A-Za-z0-9_-]{1,128}$/u;
var maximumProposalBytes = 256 * 1024;
function validOption(option) {
  const labelLength = option.label.trim().length;
  const descriptionLength = option.description?.trim().length ?? 0;
  return suggestionIdentifier.test(option.optionId) && labelLength > 0 && labelLength <= 80 && descriptionLength <= 500;
}
function normalizeOptions(options) {
  if (options.length < 2 || options.length > 4 || !options.every(validOption)) {
    throw new BoardSuggestionError(400, "\u8BF7\u9009\u62E9\u4E24\u81F3\u56DB\u6761\u6709\u6548\u65B9\u6848\u3002");
  }
  const bytes = options.reduce((total, option) => total + option.edit.bytes.byteLength, 0);
  if (bytes > maximumProposalBytes) {
    throw new BoardSuggestionError(400, "\u5EFA\u8BAE\u5185\u5BB9\u8FC7\u5927\u3002");
  }
  const ids = new Set(options.map(({ optionId }) => optionId));
  const labels = new Set(options.map(({ label }) => label.trim()));
  const edits = new Set(options.map(({ editFingerprint }) => editFingerprint));
  if ([ids, labels, edits].some((set) => set.size !== options.length)) {
    throw new BoardSuggestionError(400, "\u5EFA\u8BAE\u65B9\u6848\u7684\u6807\u8BC6\u3001\u540D\u79F0\u53CA\u64CD\u4F5C\u9700\u8981\u4E92\u4E0D\u76F8\u540C\u3002");
  }
  return options.map((option) => ({
    ...option,
    label: option.label.trim(),
    description: option.description?.trim()
  }));
}
function geometryTargets(operation) {
  switch (operation.kind) {
    case "create":
      return [];
    case "transform":
      return operation.objects.map(({ target: target2 }) => target2.objectId);
    case "duplicate":
      return operation.targets.map(({ source }) => source.objectId);
    case "lock":
    case "delete":
    case "reorder":
      return operation.targets.map(({ objectId }) => objectId);
  }
}
function operationFitsSource(request, sourceIds) {
  if (request.kind === "content") {
    return sourceIds.has(request.operation.objectId);
  }
  return geometryTargets(request.operation).every((id) => sourceIds.has(id));
}
function planSuggestion(reader2, board, request) {
  return request.kind === "geometry" ? planGeometryEdit(reader2, board, request.operation) : planContentEdit(reader2, board, request.operation);
}
function changesFitSource(changes, sourceIds) {
  const writtenIds = [
    ...changes.objects?.map(({ objectId }) => objectId) ?? [],
    ...changes.removedObjectIds ?? [],
    ...changes.payloads?.map(({ objectId }) => objectId) ?? [],
    ...changes.removedPayloadObjectIds ?? [],
    ...changes.layerPlacement?.objectIds ?? []
  ];
  return writtenIds.every((id) => sourceIds.has(id));
}
function planScopedSuggestion(reader2, board, request, sourceIds) {
  if (!operationFitsSource(request, sourceIds)) {
    return { kind: "rejected", reason: "forbidden" };
  }
  const decision = planSuggestion(reader2, board, request);
  if (decision.kind === "changes" && !changesFitSource(decision, sourceIds)) {
    return { kind: "rejected", reason: "forbidden" };
  }
  return decision;
}
function changeFingerprint(changes, digest2) {
  return digest2(
    JSON.stringify(
      changes,
      (_key, value) => typeof value === "bigint" ? value.toString() : value
    )
  );
}
function reviewChoice(reader2, board, proposal, choice, decodeEdit2, now, digest2) {
  const option = proposal?.options.find(({ optionId }) => optionId === choice.optionId);
  if (!proposal || !option || proposal.expiresAtMillis <= now) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  if (proposal.proposalVersion !== choice.expectedProposalVersion) {
    return { kind: "conflict", boardRevision: board.revision };
  }
  if (proposal.rejected || proposal.acceptedOptionId) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const source = reader2.getReviewSource(board.boardId, proposal.sourceId);
  if (!source) {
    return { kind: "rejected", reason: "forbidden" };
  }
  const plan = planScopedSuggestion(
    reader2,
    board,
    decodeEdit2(option.edit),
    new Set(source.objectIds)
  );
  if (plan.kind === "changes" && changeFingerprint(plan, digest2) !== option.plannedFingerprint) {
    return { kind: "conflict", boardRevision: board.revision };
  }
  return plan;
}
function publicSuggestion(proposal) {
  const { proposalId, sourceId, observation, proposalVersion, expiresAtMillis } = proposal;
  const { acceptedOptionId, acceptedBoardRevision, rejected: rejected5 } = proposal;
  return {
    proposalId,
    sourceId,
    observation,
    proposalVersion,
    expiresAtMillis,
    options: proposal.options.map(({ optionId, label, description }) => ({
      optionId,
      label,
      description
    })),
    acceptedOptionId,
    acceptedBoardRevision,
    rejected: rejected5
  };
}
function firstSubmission(proposal) {
  return {
    ...publicSuggestion(proposal),
    proposalVersion: 0n,
    acceptedOptionId: void 0,
    acceptedBoardRevision: void 0,
    rejected: false
  };
}
function planDraftOptions(reader2, board, options, sourceIds, decodeEdit2, digest2) {
  return options.map((option) => {
    const operation = decodeEdit2(option.edit);
    const decision = planScopedSuggestion(reader2, board, operation, sourceIds);
    if (decision.kind === "rejected" && decision.reason === "forbidden") {
      throw new BoardSuggestionError(403, "\u5EFA\u8BAE\u64CD\u4F5C\u8D85\u51FA\u5DF2\u9644\u52A0\u7684\u767D\u677F\u5BF9\u8C61\u3002");
    }
    if (decision.kind !== "changes") {
      throw new BoardSuggestionError(409, "\u5EFA\u8BAE\u65B9\u6848\u7684\u76EE\u6807\u3001\u57FA\u7EBF\u6216\u6743\u9650\u5DF2\u53D8\u5316\u3002");
    }
    return { ...option, plannedFingerprint: changeFingerprint(decision, digest2) };
  });
}

// src/modules/whiteboard/application/run-board-edit.ts
function rejected2(identity, reason) {
  return { ...identity, outcome: { kind: "rejected", reason } };
}
function runBoardEdit(repository, actor, identity, request, plan) {
  return repository.write(
    (writer2) => runBoardEditInTransaction(writer2, actor, identity, request, plan)
  );
}
function runBoardEditInTransaction(writer2, actor, identity, request, plan) {
  const { boardId, commandId } = identity;
  const access = writer2.getAccess(boardId, actor.id);
  const board = access?.canEdit ? writer2.getBoard(boardId) : void 0;
  if (!board) {
    return rejected2(identity, "forbidden");
  }
  const stored = writer2.getEditReceipt(boardId, actor.id, commandId);
  if (stored) {
    return stored.signature === request.signature ? stored.receipt : rejected2(identity, "commandIdReuse");
  }
  const decision = plan(writer2, board);
  if (decision.kind !== "changes") {
    return { ...identity, outcome: decision };
  }
  if (!canAdvanceVersion(board.revision)) {
    return rejected2(identity, "invalidEdit");
  }
  const { signature, ...details } = request;
  const outcome = writer2.applyBoardChanges(board, decision, { ...details, actorId: actor.id });
  const receipt = { ...identity, outcome };
  writer2.saveEditReceipt(actor.id, { signature, receipt });
  return receipt;
}
function readBoardEditReceipt(repository, actor, identity) {
  const { boardId, commandId } = identity;
  return repository.read(
    (reader2) => reader2.getAccess(boardId, actor.id)?.canEdit ? reader2.getEditReceipt(boardId, actor.id, commandId)?.receipt : rejected2(identity, "forbidden")
  );
}

// src/modules/whiteboard/application/board-suggestions.ts
function requireOwner(reader2, actor, boardId, kind) {
  const allowed = actor.kind === kind && reader2.canReviewBoard(boardId, actor.id);
  const board = allowed ? reader2.getBoard(boardId) : void 0;
  if (!board) {
    throw new BoardSuggestionError(403, "\u5F53\u524D\u8EAB\u4EFD\u6CA1\u6709\u767D\u677F\u5BA1\u9605\u6743\u9650\u3002");
  }
  return board;
}
function sourceTargets(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 120 || !unique.every((id) => suggestionIdentifier.test(id))) {
    throw new BoardSuggestionError(400, "\u8BF7\u9644\u52A0\u6709\u6548\u7684\u767D\u677F\u5BF9\u8C61\u9009\u533A\u3002");
  }
  return unique;
}
function commandReplay(writer2, actor, request, kind) {
  const { boardId, commandId, signature } = request;
  const stored = writer2.getSuggestionReceipt(boardId, actor.id, commandId);
  if (stored && (stored.kind !== kind || stored.signature !== signature)) {
    throw new BoardSuggestionError(409, "\u540C\u4E00\u547D\u4EE4\u4E0D\u80FD\u63D0\u4EA4\u4E0D\u540C\u7684\u5BA1\u9605\u64CD\u4F5C\u3002");
  }
  return stored?.targetId;
}
function preserveReceipt(writer2, actor, request, kind, targetId) {
  const { boardId, commandId, signature } = request;
  writer2.saveSuggestionReceipt(boardId, actor.id, commandId, { kind, signature, targetId });
}
function attachedFeedback(repository, actor, request, readFeedback) {
  if (request.origin.kind !== "feedback") {
    return void 0;
  }
  const { origin, boardId } = request;
  const replay = repository.read((reader2) => {
    requireOwner(reader2, actor, boardId, "human");
    return reader2.getSuggestionReceipt(boardId, actor.id, request.commandId);
  });
  if (replay) {
    return void 0;
  }
  const frozen = readFeedback?.(actor, boardId, origin.threadId);
  if (!frozen) {
    throw new BoardSuggestionError(404, "\u8FD9\u6761\u6279\u6CE8\u5DF2\u4E0D\u5B58\u5728\u3002");
  }
  return frozen;
}
function reviewTarget({
  objectId,
  kind,
  geometryVersion,
  payloadVersion,
  geometry
}) {
  return { objectId, kind, geometryVersion, payloadVersion, geometry };
}
function captureSource(writer2, board, actor, request, sourceId, frozen) {
  const { origin, expectedBoardRevision } = request;
  if (expectedBoardRevision !== void 0 && expectedBoardRevision !== board.revision) {
    throw new BoardSuggestionError(409, "\u767D\u677F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9644\u52A0\u9009\u533A\u3002");
  }
  if (origin.kind === "feedback") {
    if (!frozen) {
      throw new BoardSuggestionError(404, "\u8FD9\u6761\u6279\u6CE8\u5DF2\u4E0D\u5B58\u5728\u3002");
    }
    const objectIds2 = frozen.objectId ? [frozen.objectId] : [];
    return {
      boardId: board.boardId,
      sourceId,
      ownerActorId: actor.id,
      capturedBoardRevision: frozen.capturedBoardRevision,
      objectIds: objectIds2,
      feedbackThreadId: origin.threadId,
      targets: writer2.getObjects(board.boardId, objectIds2).map(reviewTarget),
      targetsBoardRevision: board.revision
    };
  }
  const objectIds = sourceTargets(origin.objectIds);
  const targets = writer2.getObjects(board.boardId, objectIds).map(reviewTarget);
  if (targets.length !== objectIds.length) {
    throw new BoardSuggestionError(409, "\u767D\u677F\u4E0A\u5DF2\u6709\u5BF9\u8C61\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6846\u9009\u3002");
  }
  return {
    boardId: board.boardId,
    sourceId,
    ownerActorId: actor.id,
    capturedBoardRevision: board.revision,
    objectIds,
    targets,
    targetsBoardRevision: board.revision
  };
}
function recordedSource(writer2, boardId, id) {
  const source = writer2.getReviewSource(boardId, id);
  if (!source) {
    throw new Error("A saved whiteboard source receipt lost its target.");
  }
  return source;
}
function recordedSuggestion(writer2, boardId, id) {
  const proposal = writer2.getSuggestion(boardId, id);
  if (!proposal) {
    throw new Error("A saved whiteboard suggestion receipt lost its target.");
  }
  return proposal;
}
function rejectPending(writer2, request, now) {
  const proposal = writer2.getSuggestion(request.boardId, request.proposalId);
  if (!proposal || proposal.expiresAtMillis <= now) {
    throw new BoardSuggestionError(404, "\u5EFA\u8BAE\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\u3002");
  }
  if (proposal.rejected || proposal.acceptedOptionId || proposal.proposalVersion !== request.expectedProposalVersion) {
    throw new BoardSuggestionError(409, "\u5EFA\u8BAE\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u770B\u3002");
  }
  return { ...proposal, proposalVersion: proposal.proposalVersion + 1n, rejected: true };
}
function acceptPending(writer2, actor, request, decodeEdit2, timeMillis, digest2) {
  const board = requireOwner(writer2, actor, request.boardId, "human");
  const { boardId, commandId, signature, proposalId, optionId } = request;
  const proposal = writer2.getSuggestion(boardId, proposalId);
  const option = proposal?.options.find((entry) => entry.optionId === optionId);
  let appliesNow = false;
  const edit = runBoardEditInTransaction(
    writer2,
    actor,
    { boardId, commandId },
    { signature, savedAtMillis: timeMillis, kind: option?.edit.kind ?? "geometry" },
    () => {
      const decision = reviewChoice(
        writer2,
        board,
        proposal,
        request,
        decodeEdit2,
        BigInt(timeMillis),
        digest2
      );
      appliesNow = decision.kind === "changes";
      return decision;
    }
  );
  if (appliesNow && proposal && edit.outcome.kind === "applied") {
    writer2.decideSuggestion({
      ...proposal,
      acceptedOptionId: optionId,
      acceptedBoardRevision: edit.outcome.boardRevision,
      proposalVersion: proposal.proposalVersion + 1n
    });
  }
  return edit;
}
function createBoardSuggestionApplication(repository, { now, newId, digest: digest2, readFeedbackSource }) {
  return {
    createSource(actor, request) {
      const frozen = attachedFeedback(repository, actor, request, readFeedbackSource);
      return repository.write((writer2) => {
        const board = requireOwner(writer2, actor, request.boardId, "human");
        const replay = commandReplay(writer2, actor, request, "source");
        if (replay) {
          return recordedSource(writer2, board.boardId, replay);
        }
        const source = captureSource(writer2, board, actor, request, newId(), frozen);
        writer2.createReviewSource(source);
        preserveReceipt(writer2, actor, request, "source", source.sourceId);
        return source;
      });
    },
    submit(actor, request, decodeEdit2) {
      return repository.write((writer2) => {
        const board = requireOwner(writer2, actor, request.boardId, "agent");
        const replay = commandReplay(writer2, actor, request, "submit");
        if (replay) {
          return firstSubmission(recordedSuggestion(writer2, board.boardId, replay));
        }
        const source = writer2.getReviewSource(board.boardId, request.sourceId);
        if (!source || source.ownerActorId !== actor.id) {
          throw new BoardSuggestionError(403, "\u7F3A\u5C11\u4E0E\u5F53\u524D\u767D\u677F\u76F8\u7B26\u7684\u7528\u6237\u9644\u52A0\u6765\u6E90\u3002");
        }
        const observation = request.observation.trim();
        if (!observation || observation.length > 160) {
          throw new BoardSuggestionError(400, "\u8BF7\u7B80\u77ED\u63CF\u8FF0\u89C2\u5BDF\u5230\u7684\u95EE\u9898\u3002");
        }
        const options = planDraftOptions(
          writer2,
          board,
          normalizeOptions(request.options),
          new Set(source.objectIds),
          decodeEdit2,
          digest2
        );
        const createdAtMillis = BigInt(now());
        const proposal = {
          boardId: board.boardId,
          ownerActorId: source.ownerActorId,
          sourceId: source.sourceId,
          proposalId: newId(),
          observation,
          createdAtMillis,
          expiresAtMillis: createdAtMillis + proposalLifetimeMillis,
          proposalVersion: 0n,
          options,
          rejected: false
        };
        writer2.createSuggestion(proposal);
        preserveReceipt(writer2, actor, request, "submit", proposal.proposalId);
        return publicSuggestion(proposal);
      });
    },
    list(actor, { boardId, limit, beforeProposalId }) {
      return repository.read((reader2) => {
        requireOwner(reader2, actor, boardId, "human");
        const proposals = reader2.listSuggestions(
          boardId,
          BigInt(now()),
          limit + 1,
          beforeProposalId
        );
        const page = proposals.slice(0, limit);
        return {
          proposals: page,
          nextBeforeProposalId: proposals.length > limit ? page.at(-1)?.proposalId : void 0
        };
      });
    },
    preview(actor, choice, decodeEdit2) {
      return repository.read((reader2) => {
        const board = requireOwner(reader2, actor, choice.boardId, "human");
        const proposal = reader2.getSuggestion(board.boardId, choice.proposalId);
        return {
          boardRevision: board.revision,
          decision: reviewChoice(
            reader2,
            board,
            proposal,
            choice,
            decodeEdit2,
            BigInt(now()),
            digest2
          )
        };
      });
    },
    accept: (actor, request, decodeEdit2) => repository.write(
      (writer2) => acceptPending(writer2, actor, request, decodeEdit2, now(), digest2)
    ),
    reject(actor, request) {
      return repository.write((writer2) => {
        const board = requireOwner(writer2, actor, request.boardId, "human");
        const replay = commandReplay(writer2, actor, request, "reject");
        if (replay) {
          return publicSuggestion(recordedSuggestion(writer2, board.boardId, replay));
        }
        const rejected5 = rejectPending(writer2, request, BigInt(now()));
        writer2.decideSuggestion(rejected5);
        preserveReceipt(writer2, actor, request, "reject", rejected5.proposalId);
        return publicSuggestion(rejected5);
      });
    }
  };
}

// src/modules/whiteboard/application/attach-image.ts
function planImageEdit(writer2, board, operation) {
  const { boardId } = board;
  const plan = planImageChanges(boardId, operation);
  if (plan.kind === "rejected") {
    return plan;
  }
  const [asset] = plan.assets;
  const objectIdUsed = writer2.hasUsedObjectId(boardId, operation.objectId);
  const assetIdUsed = writer2.getExportAsset?.(boardId, asset.assetId, 0);
  if (objectIdUsed || assetIdUsed) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  return plan;
}

// src/modules/whiteboard/application/board-editor.ts
function createBoardEditorApplication(repository, now) {
  return {
    editGeometry(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: "geometry", signature, savedAtMillis: now() },
        (writer2, board) => planGeometryEdit(writer2, board, operation)
      );
    },
    editContent(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: "content", signature, savedAtMillis: now() },
        (writer2, board) => planContentEdit(writer2, board, operation)
      );
    },
    attachImage(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: "image", signature, savedAtMillis: now() },
        (writer2, board) => planImageEdit(writer2, board, operation)
      );
    },
    getEditReceipt: (actor, identity) => readBoardEditReceipt(repository, actor, identity)
  };
}

// src/modules/whiteboard/application/board-restore.ts
var maxRestoreObjects = 2e4;
var maxRestoreSelection = 500;
var maxRestorePayloadBytes = 32n * 1024n * 1024n;
function byObjectId(objects) {
  return new Map(objects.map((object) => [object.objectId, object]));
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sameGeometry(left, right) {
  return left.kind === right.kind && left.parentId === right.parentId && left.groupId === right.groupId && same(left.geometry, right.geometry) && same(left.detail, right.detail);
}
function selectedRestore(current, historical, targets) {
  const head = [];
  const insertions = /* @__PURE__ */ new Map();
  const selected = [];
  let anchor;
  for (const saved of historical) {
    const { objectId } = saved;
    if (current.has(objectId)) {
      anchor = objectId;
      if (targets.has(objectId)) {
        selected.push(saved);
      }
    } else if (targets.has(objectId)) {
      appendRestoredObject(saved, anchor, head, insertions);
    }
  }
  const inOrder = selected.values();
  const next = [...head];
  for (const object of current.values()) {
    const replacement = targets.has(object.objectId) ? inOrder.next().value : object;
    if (replacement) {
      next.push(replacement, ...insertions.get(replacement.objectId) ?? []);
    }
  }
  return next;
}
function appendRestoredObject(object, anchor, head, insertions) {
  if (anchor === void 0) {
    head.push(object);
    return;
  }
  const siblings = insertions.get(anchor) ?? [];
  siblings.push(object);
  insertions.set(anchor, siblings);
}
function planScope(current, historical, scope2) {
  if (scope2.kind === "whole") {
    return { objects: historical, targets: new Set(historical.map(({ objectId }) => objectId)) };
  }
  const targets = new Set(scope2.objectIds);
  if (targets.size === 0 || targets.size !== scope2.objectIds.length || targets.has("")) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  if (targets.size > maxRestoreSelection) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const historicalIds = new Set(historical.map(({ objectId }) => objectId));
  if (scope2.objectIds.some((id) => !historicalIds.has(id))) {
    return { kind: "rejected", reason: "objectNotFound" };
  }
  return { objects: selectedRestore(current, historical, targets), targets };
}
function attachedIds(object) {
  if (object.detail?.kind !== "connector") {
    return [];
  }
  return [object.detail.start, object.detail.end].flatMap(
    ({ attachment }) => attachment ? [attachment.objectId] : []
  );
}
function validParentChain(object, objects, verified) {
  const path2 = /* @__PURE__ */ new Set();
  let node = object;
  while (!verified.has(node.objectId)) {
    if (path2.has(node.objectId)) {
      return false;
    }
    path2.add(node.objectId);
    if (node.parentId === void 0) {
      break;
    }
    const parent = objects.get(node.parentId);
    if (!parent) {
      return false;
    }
    node = parent;
  }
  for (const id of path2) {
    verified.add(id);
  }
  return true;
}
function validRelations(objects) {
  const verified = /* @__PURE__ */ new Set();
  for (const object of objects.values()) {
    const connected = attachedIds(object).every((id) => id !== object.objectId && objects.has(id));
    if (!connected || !validParentChain(object, objects, verified)) {
      return false;
    }
  }
  return true;
}
function protectedObjectIds(objects, isLocked2 = (object) => object.locked) {
  const visited = /* @__PURE__ */ new Set();
  const protectedObjects = /* @__PURE__ */ new Set();
  for (const object of objects.values()) {
    const path2 = [];
    let current = object;
    while (current && !visited.has(current.objectId)) {
      visited.add(current.objectId);
      path2.push(current.objectId);
      if (isLocked2(current)) {
        protectedObjects.add(current.objectId);
        break;
      }
      current = current.parentId === void 0 ? void 0 : objects.get(current.parentId);
    }
    if (current && protectedObjects.has(current.objectId)) {
      for (const id of path2) {
        protectedObjects.add(id);
      }
    }
  }
  return protectedObjects;
}
function changesProtectedGeometry(before, after) {
  return !after || before.locked && !after.locked || !sameGeometry(before, after);
}
function movedLockedAttachment(object, current, next) {
  return attachedIds(object).some((id) => !same(current.get(id)?.geometry, next.get(id)?.geometry));
}
function changesLockedLayout(current, next, protectedObjects) {
  for (const [id, before] of current) {
    const after = next.get(id);
    if (!protectedObjects.has(id)) {
      continue;
    }
    if (changesProtectedGeometry(before, after) || movedLockedAttachment(before, current, next)) {
      return true;
    }
  }
  return false;
}
function addsToProtectedParent(current, next, protectedObjects) {
  if (protectedObjects.size === 0) {
    return false;
  }
  const newParents = [...next.values()].flatMap(
    ({ objectId, parentId }) => parentId !== void 0 && current.get(objectId)?.parentId !== parentId ? [parentId] : []
  );
  if (newParents.length === 0) {
    return false;
  }
  const protectedInNext = protectedObjectIds(
    next,
    ({ objectId }) => current.get(objectId)?.locked === true
  );
  return newParents.some((id) => protectedInNext.has(id));
}
function lockedLayerMoved(current, order, targets, protectedObjects) {
  const result = new Set(order);
  const surviving = [...current.keys()].filter((id) => result.has(id));
  const before = new Map(surviving.map((id, rank2) => [id, rank2]));
  let highestSeen = -1;
  let rank = 0;
  for (const id of order) {
    const originalRank = before.get(id);
    if (originalRank === void 0) {
      continue;
    }
    const orderingChanged = originalRank !== rank || highestSeen >= originalRank;
    if (targets.has(id) && protectedObjects.has(id) && orderingChanged) {
      return true;
    }
    highestSeen = Math.max(highestSeen, originalRank);
    rank++;
  }
  return false;
}
function samePayload(left, right) {
  return left?.bodyKind === right?.bodyKind && same(left?.data, right?.data);
}
function changesLockedPayload(object, current, saved) {
  if (object.kind === "ink") {
    return !samePayload(current, saved);
  }
  return object.kind === "image" && !same(current?.data.crop, saved?.data.crop);
}
function advanceVersion(revision, ...versions) {
  const latest = versions.reduce(
    (maximum, version) => version !== void 0 && version > maximum ? version : maximum,
    revision
  );
  return canAdvanceVersion(latest) ? latest + 1n : void 0;
}
function planRestoredPayload(context, before, source) {
  const { objectId } = source;
  const previousVersion = before?.payloadVersion;
  if (previousVersion === source.payloadVersion) {
    return { changed: false, version: previousVersion };
  }
  const current = context.currentPayloads.get(objectId);
  const saved = context.savedPayloads.get(objectId);
  if (source.payloadVersion !== void 0 && !saved) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  if (samePayload(current, saved)) {
    return { changed: false, version: previousVersion };
  }
  const locked = context.protectedObjects.has(objectId);
  if (before && locked && changesLockedPayload(before, current, saved)) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  if (!saved) {
    return { changed: true };
  }
  const version = advanceVersion(context.revision, previousVersion, saved.payloadVersion);
  return version === void 0 ? { kind: "rejected", reason: "invalidEdit" } : { changed: true, version, row: { ...saved, payloadVersion: version } };
}
function restoredObject(context, source, delta) {
  const { objectId } = source;
  const before = context.currentObjects.get(objectId);
  const payload = planRestoredPayload(context, before, source);
  if ("kind" in payload) {
    return payload;
  }
  const geometryChanged = !before || !sameGeometry(before, source) || !same([before.locked, before.appearance], [source.locked, source.appearance]);
  const geometryVersion = geometryChanged ? advanceVersion(context.revision, before?.geometryVersion, source.geometryVersion) : before?.geometryVersion;
  if (geometryVersion === void 0) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  if (payload.changed || geometryChanged || before?.label !== source.label) {
    delta.objects.push({ ...source, geometryVersion, payloadVersion: payload.version });
  }
  if (payload.row) {
    delta.payloads.push(payload.row);
  } else if (payload.changed) {
    delta.removedPayloadObjectIds.push(objectId);
  }
  return void 0;
}
function collectRestoredChanges(context, scope2, removedObjectIds, order) {
  const delta = { objects: [], payloads: [], removedPayloadObjectIds: [] };
  for (const object of scope2.objects) {
    const rejection3 = scope2.targets.has(object.objectId) ? restoredObject(context, object, delta) : void 0;
    if (rejection3) {
      return rejection3;
    }
  }
  const previous = [...context.currentObjects.keys()];
  return {
    kind: "changes",
    ...delta,
    removedObjectIds,
    order: same(previous, order) ? void 0 : order
  };
}
function readRestorePayloads(reader2, boardId, revision, changed, removed) {
  const live = [...changed, ...removed];
  const liveBytes = live.length === 0 ? 0n : reader2.payloadByteSize?.(boardId, live) ?? 0n;
  if (liveBytes > maxRestorePayloadBytes) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  if (changed.length === 0) {
    return { currentPayloads: /* @__PURE__ */ new Map(), savedPayloads: /* @__PURE__ */ new Map() };
  }
  const savedBytes = reader2.payloadByteSize?.(boardId, changed, revision) ?? 0n;
  if (liveBytes + savedBytes > maxRestorePayloadBytes) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  return {
    currentPayloads: byObjectId(reader2.getPayloads(boardId, changed)),
    savedPayloads: byObjectId(reader2.getVersionPayloads(boardId, revision, changed))
  };
}
function planBoardRestore(reader2, board, revision, scope2) {
  const live = reader2.listObjects(board.boardId, maxRestoreObjects + 1);
  const historical = reader2.listVersionObjects(board.boardId, revision);
  if (Math.max(live.length, historical.length) > maxRestoreObjects) {
    return { kind: "rejected", reason: "tooLarge" };
  }
  const current = byObjectId(live);
  const restore = planScope(current, historical, scope2);
  if ("kind" in restore) {
    return restore;
  }
  const next = byObjectId(restore.objects);
  const order = [...next.keys()];
  const protectedObjects = protectedObjectIds(current);
  if (changesLockedLayout(current, next, protectedObjects) || lockedLayerMoved(current, order, restore.targets, protectedObjects) || addsToProtectedParent(current, next, protectedObjects)) {
    return { kind: "rejected", reason: "geometryLocked" };
  }
  if (!validRelations(next)) {
    return { kind: "rejected", reason: "invalidEdit" };
  }
  const payloadIds = [...restore.targets].filter(
    (id) => current.get(id)?.payloadVersion !== next.get(id)?.payloadVersion
  );
  const removedObjectIds = [...current.keys()].filter((id) => !next.has(id));
  const removedPayloadIds = removedObjectIds.filter(
    (id) => current.get(id)?.payloadVersion !== void 0
  );
  const payloads = readRestorePayloads(
    reader2,
    board.boardId,
    revision,
    payloadIds,
    removedPayloadIds
  );
  if ("kind" in payloads) {
    return payloads;
  }
  const context = {
    revision: board.revision,
    currentObjects: current,
    protectedObjects,
    ...payloads
  };
  return collectRestoredChanges(context, restore, removedObjectIds, order);
}

// src/modules/whiteboard/application/board-history.ts
var defaultPageSize2 = 20;
var maxPageSize2 = 50;
var UnavailableBoardVersion = class extends Error {
};
function currentBoard(reader2, boardId) {
  const board = reader2.getBoard(boardId);
  if (!board) {
    throw new WhiteboardAccessError();
  }
  return board;
}
function baseline({ title, revision }) {
  return { title, revision, kind: "baseline", changedObjectCount: 0 };
}
function readVersion(reader2, board, revision) {
  if (revision < 0n || revision > board.revision) {
    return void 0;
  }
  return reader2.getVersion(board.boardId, revision) ?? (revision === board.revision ? baseline(board) : void 0);
}
function versionPage(reader2, board, before, limit) {
  const earlierThan = before !== void 0 && before <= board.revision ? before : void 0;
  const found = reader2.listVersions(board.boardId, earlierThan, limit + 1);
  const versions = found.length === 0 && earlierThan === void 0 ? [baseline(board)] : found;
  const page = versions.slice(0, limit);
  return {
    currentRevision: board.revision,
    versions: page,
    nextBeforeRevision: versions.length > limit ? page.at(-1)?.revision : void 0
  };
}
function readonlySnapshotReader(reader2, revision) {
  return {
    getAccess: (boardId, actorId2) => reader2.getAccess(boardId, actorId2),
    getBoard(boardId) {
      const version = readVersion(reader2, currentBoard(reader2, boardId), revision);
      if (!version) {
        throw new UnavailableBoardVersion("The saved board version is no longer available");
      }
      return { boardId, title: version.title, revision };
    },
    listObjects: (boardId, limit) => reader2.listVersionObjects(boardId, revision).slice(0, limit),
    getObjects: (boardId, ids) => reader2.listVersionObjects(boardId, revision, ids),
    getPayloads: (boardId, ids) => reader2.getVersionPayloads(boardId, revision, ids),
    getExportAsset: (boardId, assetId, maximumBytes) => reader2.getExportAsset?.(boardId, assetId, maximumBytes),
    getReceipt: (boardId, actorId2, commandId) => reader2.getReceipt(boardId, actorId2, commandId)
  };
}
function exportSavedVersion(repository, actor, command) {
  const snapshot = {
    read: (work) => repository.read((reader2) => work(readonlySnapshotReader(reader2, command.expectedRevision))),
    write: (work) => repository.write(work)
  };
  try {
    const result = executeBoardExport(
      snapshot,
      actor,
      command,
      requireAccess3,
      (reader2) => currentBoard(reader2, command.boardId)
    );
    return result.kind === "stale" ? { kind: "unavailable" } : result;
  } catch (error) {
    if (error instanceof UnavailableBoardVersion) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
function restorePlan(reader2, board, { expectedCurrentRevision, revision, scope: scope2 }) {
  if (expectedCurrentRevision !== board.revision) {
    return { kind: "conflict", boardRevision: board.revision };
  }
  if (!canAdvanceVersion(board.revision) || !readVersion(reader2, board, revision)) {
    return { kind: "rejected", reason: "versionUnavailable" };
  }
  return planBoardRestore(reader2, board, revision, scope2);
}
function createBoardHistoryApplication(repository, now) {
  return {
    listVersions(actor, boardId, before, limit = defaultPageSize2) {
      return repository.read((reader2) => {
        requireAccess3(reader2, actor, boardId);
        const pageSize = Math.max(1, Math.min(maxPageSize2, limit || defaultPageSize2));
        return versionPage(reader2, currentBoard(reader2, boardId), before, pageSize);
      });
    },
    getVersionScene(actor, boardId, revision) {
      return repository.read((reader2) => {
        requireAccess3(reader2, actor, boardId);
        const version = readVersion(reader2, currentBoard(reader2, boardId), revision);
        if (!version) {
          return void 0;
        }
        return {
          board: { boardId, title: version.title, revision },
          access: { canEdit: false },
          objects: reader2.listVersionObjects(boardId, revision)
        };
      });
    },
    getVersionPayloads(actor, boardId, revision, objectIds) {
      return repository.read((reader2) => {
        requireAccess3(reader2, actor, boardId);
        if (!readVersion(reader2, currentBoard(reader2, boardId), revision)) {
          return void 0;
        }
        const rows = reader2.getVersionPayloads(boardId, revision, [...new Set(objectIds)]);
        const byId = new Map(rows.map((row) => [row.objectId, row]));
        return objectIds.map((id) => payloadResult(id, byId.get(id)));
      });
    },
    restoreVersion(actor, command, signature) {
      const { boardId, commandId, revision } = command;
      const commit = {
        signature,
        kind: "restore",
        savedAtMillis: now(),
        sourceRevision: revision
      };
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        commit,
        (writer2, board) => restorePlan(writer2, board, command)
      );
    },
    exportVersion(actor, command) {
      return exportSavedVersion(repository, actor, command);
    }
  };
}

// src/modules/whiteboard/application/index.ts
function createWhiteboardApplication(repository, now) {
  return {
    getBoardScene(actor, boardId) {
      return repository.read((reader2) => {
        const access = requireAccess3(reader2, actor, boardId);
        const board = reader2.getBoard(boardId);
        if (!board) {
          throw new WhiteboardAccessError();
        }
        return { board, access, objects: reader2.listObjects(boardId) };
      });
    },
    getObjectPayloads(actor, boardId, objectIds) {
      return repository.read((reader2) => {
        requireAccess3(reader2, actor, boardId);
        if (!objectIds.length) {
          return [];
        }
        const payloads = reader2.getPayloads(boardId, [...new Set(objectIds)]);
        const byId = new Map(payloads.map((payload) => [payload.objectId, payload]));
        return objectIds.map((id) => payloadResult(id, byId.get(id)));
      });
    },
    moveObjects(actor, command) {
      return repository.write((writer2) => executeMove(writer2, actor, command, now));
    },
    getCommandReceipt(actor, boardId, commandId) {
      return repository.read((reader2) => {
        requireAccess3(reader2, actor, boardId);
        return reader2.getReceipt(boardId, actor.id, commandId)?.receipt;
      });
    },
    exportBoard(actor, command) {
      return executeBoardExport(repository, actor, command, requireAccess3, (reader2) => {
        const board = reader2.getBoard(command.boardId);
        if (!board) {
          throw new WhiteboardAccessError();
        }
        return board;
      });
    }
  };
}

// src/modules/sharing/domain/index.ts
var guestRoles = ["editor", "commenter", "viewer"];
var maximumVersion2 = (1n << 63n) - 1n;
var maximumNameLength = 60;
var boardIdentity = /^[A-Za-z0-9_-]{1,128}$/u;
var guestCookie = /^[A-Za-z0-9_-]{43}$/u;
var initialSettings = { enabled: false, scope: "local", version: 0n };
function isSharingIdentifier(value) {
  return boardIdentity.test(value);
}
function isBrowserCredential(value) {
  return guestCookie.test(value);
}
function capabilities(role) {
  return {
    canEdit: role === "owner" || role === "editor",
    canComment: role !== "viewer"
  };
}
function permittedInvitations(role) {
  return role === "owner" ? guestRoles : guestRoles.slice(guestRoles.indexOf(role));
}
function nextSharingVersion(version) {
  return version < maximumVersion2 ? version + 1n : void 0;
}
function normalizeGuestName(value) {
  const name = value.trim();
  if (!name || name.length > maximumNameLength || /[\p{Cc}\p{Cs}]/u.test(name)) {
    return void 0;
  }
  return { name, nameKey: name.normalize("NFKC").toLowerCase() };
}

// src/modules/sharing/application/access.ts
var SharingAccessError = class extends Error {
};
function getSettings(reader2, boardId) {
  return reader2.getSettings(boardId) ?? initialSettings;
}
function credential(boardId, invitation, services) {
  const { role, version, seed } = invitation;
  const identity = JSON.stringify([boardId, role, version.toString(), seed]);
  return role + "." + services.digest(identity);
}
function memberUrl(origin, boardId) {
  if (origin === void 0) {
    return "";
  }
  const url = new URL("/", origin);
  url.searchParams.set("board", boardId);
  return url.href;
}
function invitationUrl(path2, boardId, invitation, services) {
  if (!path2 || !invitation.enabled) {
    return "";
  }
  const url = new URL(path2);
  url.hash = new URLSearchParams({ invite: credential(boardId, invitation, services) }).toString();
  return url.href;
}
function availableOn(settings, scope2) {
  return settings.enabled && (scope2 === "local" || settings.scope === "lan");
}
function memberCanEnter(member, invitation) {
  return !member.removed && Boolean(invitation?.enabled && invitation.version === member.invitationVersion);
}
function readInvitation(reader2, services, boardId, token2, scope2) {
  const settings = getSettings(reader2, boardId);
  const board = reader2.getBoard(boardId);
  if (!board || !availableOn(settings, scope2) || token2.length > 80) {
    return { rejection: "invitationUnavailable" };
  }
  const invitation = reader2.listInvitations(boardId).find(({ role }) => token2.startsWith(role + "."));
  if (!invitation?.enabled || !services.equalToken(token2, credential(boardId, invitation, services))) {
    return { rejection: "invitationUnavailable" };
  }
  return { value: { settings, invitation, view: { ...board, role: invitation.role } } };
}
function readGuestSession(reader2, services, boardId, actorId2, scope2) {
  const guest = reader2.getActiveGuest(boardId, actorId2, services.now());
  if (guest && (scope2 === "local" || guest.scope === "lan")) {
    const { role, name, version } = guest;
    return { boardId, actorId: actorId2, role, name, version, ...capabilities(role) };
  }
}
function guestSession(boardId, member, settings) {
  const { actorId: actorId2, name, role } = member;
  return { boardId, actorId: actorId2, name, role, version: settings.version, ...capabilities(role) };
}
function sharingView(reader2, services, boardId, role) {
  const settings = getSettings(reader2, boardId);
  const invitations = reader2.listInvitations(boardId);
  const permitted = permittedInvitations(role);
  const path2 = settings.enabled ? memberUrl(services.inviteOrigin(settings.scope), boardId) : "";
  const links = permitted.map((grade) => {
    const invitation = invitations.find(({ role: invitedRole }) => invitedRole === grade);
    return {
      role: grade,
      enabled: invitation?.enabled ?? false,
      url: invitation ? invitationUrl(path2, boardId, invitation, services) : ""
    };
  });
  const members = role === "owner" ? reader2.listMembers(boardId).map((member) => ({
    actorId: member.actorId,
    name: member.name,
    role: member.role,
    removed: member.removed,
    active: settings.enabled && memberCanEnter(
      member,
      invitations.find(({ role: invitedRole }) => invitedRole === member.role)
    ) && reader2.actorSessionIsActive(member.actorId, services.now())
  })) : [];
  return { ...settings, ...capabilities(role), boardId, role, links, members, memberUrl: path2 };
}

// src/modules/sharing/application/commands.ts
function rejected3(command, reason) {
  return {
    boardId: command.boardId,
    commandId: command.commandId,
    outcome: { kind: "rejected", reason }
  };
}
function commandSignature3(command, services) {
  const value = JSON.stringify([command.expectedVersion.toString(), command.operation]);
  return services.digest(value);
}
function validIdentity({ boardId, commandId }) {
  return isSharingIdentifier(boardId) && isSharingIdentifier(commandId);
}
function previousOrRejected(reader2, services, actorId2, command) {
  const { boardId, commandId, expectedVersion } = command;
  if (!validIdentity(command)) {
    return rejected3(command, "invalidCommand");
  }
  if (!reader2.ownsBoard(boardId, actorId2)) {
    return rejected3(command, "forbidden");
  }
  const prior = reader2.getReceipt(boardId, actorId2, commandId);
  if (prior) {
    return prior.signature === commandSignature3(command, services) ? prior.receipt : rejected3(command, "commandIdReuse");
  }
  return getSettings(reader2, boardId).version === expectedVersion ? void 0 : rejected3(command, "versionChanged");
}
function rotateInvitation(writer2, services, boardId, version, role) {
  const enabled = writer2.getInvitation(boardId, role)?.enabled ?? true;
  writer2.saveInvitation(boardId, { role, enabled, version, seed: services.newInvitationSeed() });
}
function updateInvitations(writer2, services, command, version, operation) {
  const { boardId } = command;
  if (operation.kind === "resetInvitation") {
    const roles = operation.role === void 0 ? guestRoles : [operation.role];
    for (const role of roles) {
      rotateInvitation(writer2, services, boardId, version, role);
    }
    return;
  }
  const invitation = writer2.getInvitation(boardId, operation.role);
  if (!invitation) {
    return "roleDisabled";
  }
  writer2.saveInvitation(boardId, { ...invitation, enabled: operation.enabled });
}
function updateMember(writer2, boardId, operation) {
  const member = writer2.getMember(boardId, operation.actorId);
  if (!member) {
    return "memberUnavailable";
  }
  if (operation.kind === "forgetMember") {
    if (!member.removed) {
      return "memberUnavailable";
    }
    writer2.deleteMember(boardId, member.actorId);
    return;
  }
  if (operation.kind === "removeMember") {
    if (member.removed) {
      return "memberUnavailable";
    }
    writer2.saveMember(boardId, { ...member, removed: true });
    return;
  }
  if (!("role" in operation) || member.removed !== (operation.kind === "restoreMember")) {
    return "memberUnavailable";
  }
  const invitation = writer2.getInvitation(boardId, operation.role);
  if (!invitation?.enabled) {
    return "roleDisabled";
  }
  writer2.saveMember(boardId, {
    ...member,
    removed: false,
    role: operation.role,
    invitationVersion: invitation.version
  });
}
function startSharing(writer2, services, boardId, current, next) {
  writer2.saveSettings(boardId, next);
  if (!current.enabled) {
    for (const role of guestRoles) {
      rotateInvitation(writer2, services, boardId, next.version, role);
    }
  }
}
function perform(writer2, services, command, current, version) {
  const { boardId, operation } = command;
  if (operation.kind === "setScope") {
    if (!services.inviteOrigin(operation.scope)) {
      return "lanUnavailable";
    }
    startSharing(writer2, services, boardId, current, {
      enabled: true,
      scope: operation.scope,
      version
    });
    return;
  }
  if (!current.enabled) {
    return "invalidCommand";
  }
  if (operation.kind === "stop") {
    writer2.saveSettings(boardId, { enabled: false, scope: "local", version });
    return;
  }
  const problem = operation.kind === "setInvitation" || operation.kind === "resetInvitation" ? updateInvitations(writer2, services, command, version, operation) : updateMember(writer2, boardId, operation);
  if (problem) {
    return problem;
  }
  writer2.saveSettings(boardId, { ...current, version });
}
function applySharing(writer2, services, actorId2, command) {
  const prior = previousOrRejected(writer2, services, actorId2, command);
  if (prior) {
    return prior;
  }
  const { boardId, commandId } = command;
  const current = getSettings(writer2, boardId);
  const version = nextSharingVersion(current.version);
  if (version === void 0) {
    return rejected3(command, "invalidCommand");
  }
  const problem = perform(writer2, services, command, current, version);
  if (problem) {
    return rejected3(command, problem);
  }
  const receipt = { boardId, commandId, outcome: { kind: "applied", version } };
  writer2.saveReceipt(actorId2, { signature: commandSignature3(command, services), receipt });
  return receipt;
}

// src/modules/sharing/application/index.ts
var browserSessionMillis = 365 * 24 * 60 * 60 * 1e3;
function validBrowserCredential(value) {
  return isBrowserCredential(value);
}
function join(writer2, services, request) {
  const { boardId, invitationToken, name: rawName, scope: scope2, browserToken } = request;
  const match = readInvitation(writer2, services, boardId, invitationToken, scope2);
  if ("rejection" in match) {
    return match;
  }
  const name = normalizeGuestName(rawName);
  if (!name || !isBrowserCredential(browserToken)) {
    return { rejection: "invalidCommand" };
  }
  const hash = services.digest(browserToken);
  const now = services.now();
  const browser = writer2.getBrowserSession(hash);
  if (browser && browser.expiresAt <= now) {
    return { rejection: "invitationUnavailable" };
  }
  const actorId2 = browser?.actorId ?? services.newGuestId();
  const previous = writer2.getMember(boardId, actorId2);
  if (previous?.removed) {
    return { rejection: "memberUnavailable" };
  }
  const { invitation, settings } = match.value;
  const existing = previous && readGuestSession(writer2, services, boardId, actorId2, scope2);
  if (existing) {
    return { value: existing };
  }
  const occupied = writer2.findMemberByName(boardId, name.nameKey);
  if (occupied && occupied.actorId !== actorId2) {
    return { rejection: "nameTaken" };
  }
  if (!browser) {
    writer2.saveBrowserSession(hash, { actorId: actorId2, expiresAt: now + browserSessionMillis });
  }
  const member = {
    ...name,
    actorId: actorId2,
    role: invitation.role,
    removed: false,
    invitationVersion: invitation.version
  };
  writer2.saveMember(boardId, member);
  return { value: guestSession(boardId, member, settings) };
}
function readSharingRole(reader2, services, boardId, actorId2, scope2) {
  if (scope2) {
    return readGuestSession(reader2, services, boardId, actorId2, scope2)?.role;
  }
  return reader2.ownsBoard(boardId, actorId2) ? "owner" : void 0;
}
function createSharingApplication(repository, services) {
  function readBrowser(token2) {
    if (isBrowserCredential(token2)) {
      return repository.read((reader2) => reader2.getBrowserSession(services.digest(token2)));
    }
  }
  return {
    activeSharingScopes: () => repository.read((reader2) => reader2.activeSharingScopes()),
    getSharing: (boardId, actorId2, scope2) => repository.read((reader2) => {
      const role = readSharingRole(reader2, services, boardId, actorId2, scope2);
      if (!role) {
        throw new SharingAccessError("Sharing access is unavailable.");
      }
      return sharingView(reader2, services, boardId, role);
    }),
    getReceipt: (boardId, actorId2, commandId) => repository.read((reader2) => {
      if (!reader2.ownsBoard(boardId, actorId2)) {
        throw new SharingAccessError("Sharing owner access is required.");
      }
      return reader2.getReceipt(boardId, actorId2, commandId)?.receipt;
    }),
    prepareUpdate: (actorId2, command) => repository.read((reader2) => previousOrRejected(reader2, services, actorId2, command)),
    update: (actorId2, command) => repository.write((writer2) => applySharing(writer2, services, actorId2, command)),
    inspectInvitation: ({ boardId, scope: scope2, invitationToken }) => repository.read((reader2) => {
      const result = readInvitation(reader2, services, boardId, invitationToken, scope2);
      return "value" in result ? { value: result.value.view } : result;
    }),
    joinInvitation: (request) => repository.write((writer2) => join(writer2, services, request)),
    browserActor: (token2) => {
      const expires = readBrowser(token2);
      return expires && expires.expiresAt > services.now() ? expires.actorId : void 0;
    },
    browserTokenExpired: (token2) => {
      const session = readBrowser(token2);
      return session !== void 0 && session.expiresAt <= services.now();
    },
    guestAccess: (boardId, actorId2, scope2) => repository.read((reader2) => readGuestSession(reader2, services, boardId, actorId2, scope2))
  };
}

// src/entrypoints/http/archive-routes.ts
import { Buffer as Buffer3 } from "node:buffer";

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/is-message.js
function isMessage(arg, schema2) {
  const isMessage2 = arg !== null && typeof arg == "object" && "$typeName" in arg && typeof arg.$typeName == "string";
  if (!isMessage2) {
    return false;
  }
  if (schema2 === void 0) {
    return true;
  }
  return schema2.typeName === arg.$typeName;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/descriptors.js
var ScalarType;
(function(ScalarType2) {
  ScalarType2[ScalarType2["DOUBLE"] = 1] = "DOUBLE";
  ScalarType2[ScalarType2["FLOAT"] = 2] = "FLOAT";
  ScalarType2[ScalarType2["INT64"] = 3] = "INT64";
  ScalarType2[ScalarType2["UINT64"] = 4] = "UINT64";
  ScalarType2[ScalarType2["INT32"] = 5] = "INT32";
  ScalarType2[ScalarType2["FIXED64"] = 6] = "FIXED64";
  ScalarType2[ScalarType2["FIXED32"] = 7] = "FIXED32";
  ScalarType2[ScalarType2["BOOL"] = 8] = "BOOL";
  ScalarType2[ScalarType2["STRING"] = 9] = "STRING";
  ScalarType2[ScalarType2["BYTES"] = 12] = "BYTES";
  ScalarType2[ScalarType2["UINT32"] = 13] = "UINT32";
  ScalarType2[ScalarType2["SFIXED32"] = 15] = "SFIXED32";
  ScalarType2[ScalarType2["SFIXED64"] = 16] = "SFIXED64";
  ScalarType2[ScalarType2["SINT32"] = 17] = "SINT32";
  ScalarType2[ScalarType2["SINT64"] = 18] = "SINT64";
})(ScalarType || (ScalarType = {}));

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js
function varint64read() {
  const buf = this.buf;
  let pos = this.pos;
  let lo = 0;
  let hi = 0;
  for (let shift = 0; shift < 28; shift += 7) {
    const b = buf[pos++];
    lo |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  const middleByte = buf[pos++];
  lo |= (middleByte & 15) << 28;
  hi = (middleByte & 112) >> 4;
  if ((middleByte & 128) == 0) {
    this.pos = pos;
    this.assertBounds();
    this.varint64Lo = lo;
    this.varint64Hi = hi;
    return;
  }
  for (let shift = 3; shift <= 31; shift += 7) {
    const b = buf[pos++];
    hi |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  throw new Error("invalid varint");
}
var TWO_PWR_32_DBL = 4294967296;
function int64FromString(dec) {
  const minus = dec[0] === "-";
  if (minus) {
    dec = dec.slice(1);
  }
  const base = 1e6;
  let lowBits = 0;
  let highBits = 0;
  function add1e6digit(begin, end) {
    const digit1e6 = Number(dec.slice(begin, end));
    highBits *= base;
    lowBits = lowBits * base + digit1e6;
    if (lowBits >= TWO_PWR_32_DBL) {
      highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
      lowBits = lowBits % TWO_PWR_32_DBL;
    }
  }
  add1e6digit(-24, -18);
  add1e6digit(-18, -12);
  add1e6digit(-12, -6);
  add1e6digit(-6);
  return minus ? negate(lowBits, highBits) : newBits(lowBits, highBits);
}
function int64ToString(lo, hi) {
  let bits = newBits(lo, hi);
  const negative = bits.hi & 2147483648;
  if (negative) {
    bits = negate(bits.lo, bits.hi);
  }
  const result = uInt64ToString(bits.lo, bits.hi);
  return negative ? "-" + result : result;
}
function uInt64ToString(lo, hi) {
  ({ lo, hi } = toUnsigned(lo, hi));
  if (hi <= 2097151) {
    return String(TWO_PWR_32_DBL * hi + lo);
  }
  const low = lo & 16777215;
  const mid = (lo >>> 24 | hi << 8) & 16777215;
  const high = hi >> 16 & 65535;
  let digitA = low + mid * 6777216 + high * 6710656;
  let digitB = mid + high * 8147497;
  let digitC = high * 2;
  const base = 1e7;
  if (digitA >= base) {
    digitB += Math.floor(digitA / base);
    digitA %= base;
  }
  if (digitB >= base) {
    digitC += Math.floor(digitB / base);
    digitB %= base;
  }
  return digitC.toString() + decimalFrom1e7WithLeadingZeros(digitB) + decimalFrom1e7WithLeadingZeros(digitA);
}
function toUnsigned(lo, hi) {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}
function newBits(lo, hi) {
  return { lo: lo | 0, hi: hi | 0 };
}
function negate(lowBits, highBits) {
  highBits = ~highBits;
  if (lowBits) {
    lowBits = ~lowBits + 1;
  } else {
    highBits += 1;
  }
  return newBits(lowBits, highBits);
}
var decimalFrom1e7WithLeadingZeros = (digit1e7) => {
  const partial = String(digit1e7);
  return "0000000".slice(partial.length) + partial;
};
function varint32write(value, bytes) {
  if (value >>> 0 < 128) {
    bytes.push(value);
    return;
  }
  if (value >= 0) {
    while (value > 127) {
      bytes.push(value & 127 | 128);
      value = value >>> 7;
    }
    bytes.push(value);
  } else {
    for (let i = 0; i < 9; i++) {
      bytes.push(value & 127 | 128);
      value = value >> 7;
    }
    bytes.push(1);
  }
}
function varint32read() {
  let b = this.buf[this.pos++];
  if ((b & 128) === 0) {
    this.assertBounds();
    return b;
  }
  let result = b & 127;
  b = this.buf[this.pos++];
  result |= (b & 127) << 7;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 14;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 21;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 15) << 28;
  for (let readBytes2 = 5; (b & 128) !== 0 && readBytes2 < 10; readBytes2++)
    b = this.buf[this.pos++];
  if ((b & 128) !== 0)
    throw new Error("invalid varint");
  this.assertBounds();
  return result >>> 0;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/proto-int64.js
var protoInt64 = /* @__PURE__ */ makeInt64Support();
function makeInt64Support() {
  const dv = new DataView(new ArrayBuffer(8));
  const ok = typeof BigInt === "function" && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function" && (!!globalThis.Deno || !!globalThis.Bun || typeof process != "object" || typeof process.env != "object" || process.env.BUF_BIGINT_DISABLE !== "1");
  if (ok) {
    const MIN = BigInt("-9223372036854775808");
    const MAX = BigInt("9223372036854775807");
    const UMIN = BigInt("0");
    const UMAX = BigInt("18446744073709551615");
    return {
      zero: BigInt(0),
      supported: true,
      parse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > MAX || bi < MIN) {
          throw new Error(`invalid int64: ${value}`);
        }
        return bi;
      },
      uParse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > UMAX || bi < UMIN) {
          throw new Error(`invalid uint64: ${value}`);
        }
        return bi;
      },
      enc(value) {
        dv.setBigInt64(0, this.parse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      uEnc(value) {
        dv.setBigInt64(0, this.uParse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      dec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigInt64(0, true);
      },
      uDec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigUint64(0, true);
      }
    };
  }
  return {
    zero: "0",
    supported: false,
    parse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return value;
    },
    uParse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return value;
    },
    enc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return int64FromString(value);
    },
    uEnc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return int64FromString(value);
    },
    dec(lo, hi) {
      return int64ToString(lo, hi);
    },
    uDec(lo, hi) {
      return uInt64ToString(lo, hi);
    }
  };
}
function assertInt64String(value) {
  if (!/^-?[0-9]+$/.test(value)) {
    throw new Error("invalid int64: " + value);
  }
}
function assertUInt64String(value) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid uint64: " + value);
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/scalar.js
function scalarZeroValue(type, longAsString) {
  switch (type) {
    case ScalarType.STRING:
      return "";
    case ScalarType.BOOL:
      return false;
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return 0;
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.SFIXED64:
    case ScalarType.FIXED64:
    case ScalarType.SINT64:
      return longAsString ? "0" : protoInt64.zero;
    case ScalarType.BYTES:
      return new Uint8Array(0);
    default:
      return 0;
  }
}
function isScalarZeroValue(type, value) {
  switch (type) {
    case ScalarType.BOOL:
      return value === false;
    case ScalarType.STRING:
      return value === "";
    case ScalarType.BYTES:
      return value instanceof Uint8Array && !value.byteLength;
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return Object.is(value, 0);
    default:
      return value == 0;
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/unsafe.js
var IMPLICIT = 2;
var unsafeLocal = /* @__PURE__ */ Symbol.for("reflect unsafe local");
function unsafeOneofCase(target2, oneof) {
  const c = target2[oneof.localName].case;
  if (c === void 0) {
    return c;
  }
  return oneof.fields.find((f) => f.localName === c);
}
function unsafeIsSet(target2, field) {
  const name = field.localName;
  if (field.oneof) {
    return target2[field.oneof.localName].case === name;
  }
  if (field.presence != IMPLICIT) {
    return target2[name] !== void 0 && Object.prototype.hasOwnProperty.call(target2, name);
  }
  switch (field.fieldKind) {
    case "list":
      return target2[name].length > 0;
    case "map":
      return Object.keys(target2[name]).length > 0;
    case "scalar":
      return !isScalarZeroValue(field.scalar, target2[name]);
    case "enum":
      return target2[name] !== field.enum.values[0].number;
  }
  throw new Error("message field with implicit presence");
}
function unsafeIsSetExplicit(target2, localName) {
  return Object.prototype.hasOwnProperty.call(target2, localName) && target2[localName] !== void 0;
}
function unsafeGet(target2, field) {
  if (field.oneof) {
    const oneof = target2[field.oneof.localName];
    if (oneof.case === field.localName) {
      return oneof.value;
    }
    return void 0;
  }
  return target2[field.localName];
}
function unsafeSet(target2, field, value) {
  if (field.oneof) {
    target2[field.oneof.localName] = {
      case: field.localName,
      value
    };
  } else {
    target2[field.localName] = value;
  }
}
function setOwn(obj, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(obj, "__proto__", {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    obj[key] = value;
  }
}
function getOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : void 0;
}
function unsafeClear(target2, field) {
  const name = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    if (target2[oneofLocalName].case === name) {
      target2[oneofLocalName] = { case: void 0 };
    }
  } else if (field.presence != IMPLICIT) {
    delete target2[name];
  } else {
    switch (field.fieldKind) {
      case "map":
        target2[name] = {};
        break;
      case "list":
        target2[name] = [];
        break;
      case "enum":
        target2[name] = field.enum.values[0].number;
        break;
      case "scalar":
        target2[name] = scalarZeroValue(field.scalar, field.longAsString);
        break;
    }
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/guard.js
function isObject(arg) {
  return arg !== null && typeof arg == "object" && !Array.isArray(arg);
}
function isReflectList(arg, field) {
  var _a, _b, _c, _d;
  if (isObject(arg) && unsafeLocal in arg && "add" in arg && "field" in arg && typeof arg.field == "function") {
    if (field !== void 0) {
      const a = field;
      const b = arg.field();
      return a.listKind == b.listKind && a.scalar === b.scalar && ((_a = a.message) === null || _a === void 0 ? void 0 : _a.typeName) === ((_b = b.message) === null || _b === void 0 ? void 0 : _b.typeName) && ((_c = a.enum) === null || _c === void 0 ? void 0 : _c.typeName) === ((_d = b.enum) === null || _d === void 0 ? void 0 : _d.typeName);
    }
    return true;
  }
  return false;
}
function isReflectMap(arg, field) {
  var _a, _b, _c, _d;
  if (isObject(arg) && unsafeLocal in arg && "has" in arg && "field" in arg && typeof arg.field == "function") {
    if (field !== void 0) {
      const a = field, b = arg.field();
      return a.mapKey === b.mapKey && a.mapKind == b.mapKind && a.scalar === b.scalar && ((_a = a.message) === null || _a === void 0 ? void 0 : _a.typeName) === ((_b = b.message) === null || _b === void 0 ? void 0 : _b.typeName) && ((_c = a.enum) === null || _c === void 0 ? void 0 : _c.typeName) === ((_d = b.enum) === null || _d === void 0 ? void 0 : _d.typeName);
    }
    return true;
  }
  return false;
}
function isReflectMessage(arg, messageDesc2) {
  return isObject(arg) && unsafeLocal in arg && "desc" in arg && isObject(arg.desc) && arg.desc.kind === "message" && (messageDesc2 === void 0 || arg.desc.typeName == messageDesc2.typeName);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/wrappers.js
function isWrapper(arg) {
  return isWrapperTypeName(arg.$typeName);
}
function isWrapperDesc(messageDesc2) {
  const f = messageDesc2.fields[0];
  return isWrapperTypeName(messageDesc2.typeName) && f !== void 0 && f.fieldKind == "scalar" && f.name == "value" && f.number == 1;
}
function hasCustomJsonRepresentation(desc) {
  switch (desc.typeName) {
    case "google.protobuf.Any":
    case "google.protobuf.Timestamp":
    case "google.protobuf.Duration":
    case "google.protobuf.FieldMask":
    case "google.protobuf.Struct":
    case "google.protobuf.Value":
    case "google.protobuf.ListValue":
      return true;
    default:
      return isWrapperDesc(desc);
  }
}
var wrapperTypeNames = /* @__PURE__ */ new Set([
  "google.protobuf.DoubleValue",
  "google.protobuf.FloatValue",
  "google.protobuf.Int64Value",
  "google.protobuf.UInt64Value",
  "google.protobuf.Int32Value",
  "google.protobuf.UInt32Value",
  "google.protobuf.BoolValue",
  "google.protobuf.StringValue",
  "google.protobuf.BytesValue"
]);
function isWrapperTypeName(name) {
  return wrapperTypeNames.has(name);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/create.js
var EDITION_PROTO3 = 999;
var EDITION_PROTO2 = 998;
var IMPLICIT2 = 2;
function create(schema2, init) {
  if (isMessage(init, schema2)) {
    return init;
  }
  return compiledCreate(schema2)(init);
}
var compiledCreates = /* @__PURE__ */ new WeakMap();
function compiledCreate(desc) {
  let compiled = compiledCreates.get(desc);
  if (compiled === void 0) {
    compiled = compileCreate(desc);
    compiledCreates.set(desc, compiled);
  }
  return compiled;
}
var INIT_SINGULAR = 0;
var INIT_LIST = 1;
var INIT_MAP = 2;
var INIT_ONEOF = 3;
function compileCreate(desc) {
  const typeName = desc.typeName;
  const { properties, prototype } = compileInitMessage(desc);
  return (init) => {
    let message;
    if (prototype !== void 0) {
      message = Object.create(prototype);
      message.$typeName = typeName;
    } else {
      message = { $typeName: typeName };
    }
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      const name = property.name;
      const initValue = init === null || init === void 0 ? void 0 : init[name];
      switch (property.kind) {
        case INIT_SINGULAR:
          if (initValue != null) {
            message[name] = property.convert !== void 0 ? property.convert(initValue) : initValue;
          } else if (property.constant !== void 0) {
            message[name] = property.constant;
          }
          break;
        case INIT_LIST:
          message[name] = property.convert !== void 0 && Array.isArray(initValue) ? initValue.map(property.convert) : initValue !== null && initValue !== void 0 ? initValue : [];
          break;
        case INIT_MAP:
          if (property.convert === void 0 || !isObject(initValue)) {
            message[name] = initValue !== null && initValue !== void 0 ? initValue : {};
          } else {
            const converted = {};
            const keys = Object.keys(initValue);
            for (let k = 0; k < keys.length; k++) {
              setOwn(converted, keys[k], property.convert(initValue[keys[k]]));
            }
            message[name] = converted;
          }
          break;
        case INIT_ONEOF: {
          const oneofValue = initValue;
          if ((oneofValue === null || oneofValue === void 0 ? void 0 : oneofValue.case) != null) {
            const convert = property.convert.get(oneofValue.case);
            if (convert !== void 0) {
              message[name] = {
                case: oneofValue.case,
                value: convert(oneofValue.value)
              };
              break;
            }
          }
          message[name] = { case: void 0 };
          break;
        }
      }
    }
    return message;
  };
}
function compileInitMessage(desc) {
  var _a, _b;
  const properties = [];
  const prototype = {};
  const usePrototype = needsPrototypeChain(desc);
  for (const member of desc.members) {
    const name = member.localName;
    if (member.kind == "oneof") {
      properties.push({
        name,
        kind: INIT_ONEOF,
        constant: void 0,
        convert: compileConvertOneof(member)
      });
      continue;
    }
    switch (member.fieldKind) {
      case "message": {
        properties.push({
          name,
          kind: INIT_SINGULAR,
          constant: void 0,
          convert: compileConvertMessage(member)
        });
        break;
      }
      case "list": {
        properties.push({
          name,
          kind: INIT_LIST,
          constant: void 0,
          convert: member.listKind == "message" ? (_a = compileConvertMessage(member)) !== null && _a !== void 0 ? _a : ((value) => value) : member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        break;
      }
      case "map": {
        properties.push({
          name,
          kind: INIT_MAP,
          constant: void 0,
          convert: member.mapKind == "message" ? (_b = compileConvertMessage(member)) !== null && _b !== void 0 ? _b : ((value) => value) : member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        break;
      }
      default: {
        const zeroValue = createZeroValue(member);
        properties.push({
          name,
          kind: INIT_SINGULAR,
          constant: member.presence == IMPLICIT2 ? zeroValue : void 0,
          convert: member.fieldKind == "scalar" && member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        if (usePrototype) {
          prototype[name] = zeroValue;
        }
        break;
      }
    }
  }
  return {
    properties,
    prototype: usePrototype ? prototype : void 0
  };
}
function compileConvertOneof(oneof) {
  const converters = /* @__PURE__ */ new Map();
  for (const field of oneof.fields) {
    let convert;
    if (field.fieldKind == "message") {
      convert = compileConvertMessage(field);
    } else if (field.fieldKind == "scalar" && field.scalar == ScalarType.BYTES) {
      convert = toU8Arr;
    }
    converters.set(field.localName, convert !== null && convert !== void 0 ? convert : ((value) => value));
  }
  return converters;
}
function compileConvertMessage(field) {
  if (field.fieldKind == "message" && !field.oneof && isWrapperDesc(field.message)) {
    return field.message.fields[0].scalar == ScalarType.BYTES ? toU8Arr : void 0;
  }
  if (field.message.typeName == "google.protobuf.Struct" && field.parent.typeName !== "google.protobuf.Value") {
    return void 0;
  }
  const messageDesc2 = field.message;
  let compiled;
  return (value) => {
    if (!isObject(value) || isMessage(value, messageDesc2)) {
      return value;
    }
    compiled !== null && compiled !== void 0 ? compiled : compiled = compiledCreate(messageDesc2);
    return compiled(value);
  };
}
function toU8Arr(value) {
  return Array.isArray(value) ? new Uint8Array(value) : value;
}
function needsPrototypeChain(desc) {
  switch (desc.file.edition) {
    case EDITION_PROTO3:
      return false;
    case EDITION_PROTO2:
      return true;
    default:
      return desc.fields.some((f) => f.presence != IMPLICIT2 && f.fieldKind != "message" && !f.oneof);
  }
}
function createZeroValue(field) {
  const defaultValue = field.getDefaultValue();
  if (defaultValue !== void 0) {
    return field.fieldKind == "scalar" && field.longAsString ? defaultValue.toString() : defaultValue;
  }
  return field.fieldKind == "scalar" ? scalarZeroValue(field.scalar, field.longAsString) : field.enum.values[0].number;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/error.js
var errorNames = [
  "FieldValueInvalidError",
  "FieldListRangeError",
  "ForeignFieldError"
];
var FieldError = class extends Error {
  constructor(fieldOrOneof, message, name = "FieldValueInvalidError") {
    super(message);
    this.name = name;
    this.field = () => fieldOrOneof;
  }
};
function isFieldError(arg) {
  return arg instanceof Error && errorNames.includes(arg.name) && "field" in arg && typeof arg.field == "function";
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wire/text-encoding.js
var te;
function configureTextEncoding(textEncoding) {
  var _a;
  te = Object.assign(Object.assign({}, textEncoding), { encodeUtf8Into: (_a = textEncoding.encodeUtf8Into) !== null && _a !== void 0 ? _a : emulateEncodeInto(textEncoding.encodeUtf8.bind(textEncoding)) });
}
function getTextEncoding() {
  if (!te) {
    const globals = globalThis;
    if (!globals.TextEncoder || !globals.TextDecoder) {
      throw new Error("encoding API missing: install TextEncoder and TextDecoder on globalThis");
    }
    const textEncoder = new globals.TextEncoder();
    const textDecoder = new globals.TextDecoder("utf-8", {
      ignoreBOM: true
    });
    let textDecoderStrict;
    const config = {
      encodeUtf8(text2) {
        return textEncoder.encode(text2);
      },
      decodeUtf8(bytes, strict) {
        if (strict) {
          if (!textDecoderStrict) {
            textDecoderStrict = new globals.TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true
            });
          }
          return textDecoderStrict.decode(bytes);
        }
        return textDecoder.decode(bytes);
      },
      checkUtf8(text2) {
        try {
          encodeURIComponent(text2);
          return true;
        } catch (_) {
          return false;
        }
      }
    };
    if (textEncoder.encodeInto) {
      config.encodeUtf8Into = textEncoder.encodeInto.bind(textEncoder);
    }
    const nativeStringIsWellFormed = String.prototype.isWellFormed;
    if (nativeStringIsWellFormed) {
      config.checkUtf8 = (text2) => {
        return nativeStringIsWellFormed.call(text2);
      };
    }
    configureTextEncoding(config);
  }
  return te;
}
function emulateEncodeInto(encodeUtf8) {
  return (text2, dest) => {
    const bytes = encodeUtf8(text2);
    dest.set(bytes);
    return { written: bytes.byteLength };
  };
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wire/binary-encoding.js
var WireType;
(function(WireType2) {
  WireType2[WireType2["Varint"] = 0] = "Varint";
  WireType2[WireType2["Bit64"] = 1] = "Bit64";
  WireType2[WireType2["LengthDelimited"] = 2] = "LengthDelimited";
  WireType2[WireType2["StartGroup"] = 3] = "StartGroup";
  WireType2[WireType2["EndGroup"] = 4] = "EndGroup";
  WireType2[WireType2["Bit32"] = 5] = "Bit32";
})(WireType || (WireType = {}));
var UINT32_MAX = 4294967295;
var INT32_MAX = 2147483647;
var INT32_MIN = -2147483648;
var BinaryWriter = class {
  constructor(encodeUtf8) {
    this.stackPos = [];
    this.encodeUtf8Into = encodeUtf8 ? emulateEncodeInto(encodeUtf8) : getTextEncoding().encodeUtf8Into;
    this.buffer = EMPTY_BUFFER;
    this.viewCache = EMPTY_VIEW;
    this.pos = 0;
  }
  ensureCapacity(size) {
    const required = this.pos + size;
    if (required > this.buffer.length) {
      let newLen = this.buffer.length || INITIAL_SIZE;
      while (newLen < required)
        newLen *= 2;
      const newBuf = new Uint8Array(newLen);
      if (this.pos > 0)
        newBuf.set(this.buffer);
      this.buffer = newBuf;
    }
  }
  /**
   * The DataView over `buffer`, rebuilt only if the buffer has grown since it
   * was last used.
   */
  view() {
    const bytes = this.buffer;
    const view = this.viewCache;
    if (view.byteLength === bytes.byteLength)
      return view;
    const newView = new DataView(bytes.buffer);
    this.viewCache = newView;
    return newView;
  }
  /**
   * Return all bytes written and reset this writer.
   */
  finish() {
    const result = this.buffer.slice(0, this.pos);
    this.pos = 0;
    this.stackPos = [];
    return result;
  }
  /**
   * Start a new fork for length-delimited data like a message
   * or a packed repeated field.
   *
   * Must be joined later with `join()`.
   */
  fork() {
    this.stackPos.push(this.pos);
    this.ensureCapacity(DEFAULT_LEN_PREFIX_SIZE);
    this.buffer[this.pos++] = 0;
    return this;
  }
  /**
   * Join the last fork. Write its length and bytes, then
   * return to the previous state.
   */
  join() {
    const forkPos = this.stackPos.pop();
    if (forkPos === void 0)
      throw new Error("invalid state, fork stack empty");
    const len = this.pos - forkPos - DEFAULT_LEN_PREFIX_SIZE;
    const lenPrefixSize = varint32Size(len);
    if (lenPrefixSize > DEFAULT_LEN_PREFIX_SIZE) {
      this.ensureCapacity(lenPrefixSize - DEFAULT_LEN_PREFIX_SIZE);
      this.buffer.copyWithin(forkPos + lenPrefixSize, forkPos + DEFAULT_LEN_PREFIX_SIZE, this.pos);
    }
    this.pos = forkPos;
    this.uint32(len);
    this.pos += len;
    return this;
  }
  /**
   * Writes a tag (field number and wire type).
   *
   * Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
   *
   * Generated code should compute the tag ahead of time and call `uint32()`.
   */
  tag(fieldNo, type) {
    return this.uint32((fieldNo << 3 | type) >>> 0);
  }
  /**
   * Write a chunk of raw bytes.
   */
  raw(chunk) {
    this.ensureCapacity(chunk.length);
    this.buffer.set(chunk, this.pos);
    this.pos += chunk.length;
    return this;
  }
  /**
   * Write a `uint32` value, an unsigned 32 bit varint.
   */
  uint32(value) {
    assertUInt32(value);
    this.ensureCapacity(5);
    if (value < 128) {
      this.buffer[this.pos++] = value;
      return this;
    }
    while (value > 127) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>>= 7;
    }
    this.buffer[this.pos++] = value;
    return this;
  }
  /**
   * Write a `int32` value, a signed 32 bit varint.
   */
  int32(value) {
    assertInt32(value);
    if (value >= 0) {
      return this.uint32(value);
    }
    this.ensureCapacity(10);
    for (let i = 0; i < 9; i++) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>= 7;
    }
    this.buffer[this.pos++] = 1;
    return this;
  }
  /**
   * Write a `bool` value, a varint.
   */
  bool(value) {
    this.ensureCapacity(1);
    this.buffer[this.pos++] = value ? 1 : 0;
    return this;
  }
  /**
   * Write a `bytes` value, length-delimited arbitrary data.
   */
  bytes(value) {
    this.uint32(value.byteLength);
    return this.raw(value);
  }
  /**
   * Write a `string` value, length-delimited data converted to UTF-8 text.
   */
  string(value) {
    if (typeof value !== "string") {
      value = String(value);
    }
    const len = value.length;
    if (len <= ASCII_MAX_LENGTH) {
      this.ensureCapacity(len + 1);
      const ascii = this.buffer;
      let pos = this.pos;
      ascii[pos++] = len;
      let i = 0;
      for (; i < len; i++) {
        const code = value.charCodeAt(i);
        if (code > 127)
          break;
        ascii[pos++] = code;
      }
      if (i == len) {
        this.pos = pos;
        return this;
      }
    }
    this.ensureCapacity(len * 3 + 5);
    const lenPrefixSizeGuess = varint32Size(len);
    const buf = this.buffer;
    const start = this.pos;
    const { written } = this.encodeUtf8Into(value, buf.subarray(start + lenPrefixSizeGuess));
    const lenPrefixSize = varint32Size(written);
    if (lenPrefixSize != lenPrefixSizeGuess) {
      buf.copyWithin(start + lenPrefixSize, start + lenPrefixSizeGuess, start + lenPrefixSizeGuess + written);
    }
    this.uint32(written);
    this.pos += written;
    return this;
  }
  /**
   * Write a `float` value, 32-bit floating point number.
   */
  float(value) {
    assertFloat32(value);
    this.ensureCapacity(4);
    this.view().setFloat32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `double` value, a 64-bit floating point number.
   */
  double(value) {
    this.ensureCapacity(8);
    this.view().setFloat64(this.pos, value, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
   */
  fixed32(value) {
    assertUInt32(value);
    this.ensureCapacity(4);
    this.view().setUint32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
   */
  sfixed32(value) {
    assertInt32(value);
    this.ensureCapacity(4);
    this.view().setInt32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
   */
  sint32(value) {
    assertInt32(value);
    return this.uint32((value << 1 ^ value >> 31) >>> 0);
  }
  /**
   * Write a `sfixed64` value, a signed, fixed-length 64-bit integer.
   */
  sfixed64(value) {
    const tc = protoInt64.enc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
   */
  fixed64(value) {
    const tc = protoInt64.uEnc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `int64` value, a signed 64-bit varint.
   */
  int64(value) {
    const tc = protoInt64.enc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64(value) {
    const tc = protoInt64.enc(value), sign = tc.hi >> 31, lo = tc.lo << 1 ^ sign, hi = (tc.hi << 1 | tc.lo >>> 31) ^ sign;
    return this.writeVarint64(lo, hi);
  }
  /**
   * Write a `uint64` value, an unsigned 64-bit varint.
   */
  uint64(value) {
    const tc = protoInt64.uEnc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a 64-bit varint directly into the buffer. Accepts the value as
   * split low/high 32-bit words.
   *
   * Ported from varint64write() to avoid the intermediate number[] buffer.
   * See https://github.com/protocolbuffers/protobuf/blob/8a71927d74a4ce34efe2d8769fda198f52d20d12/js/experimental/runtime/kernel/writer.js#L344
   */
  writeVarint64(lo, hi) {
    this.ensureCapacity(10);
    const buf = this.buffer;
    let pos = this.pos;
    for (let i = 0; i < 28; i = i + 7) {
      const shift = lo >>> i;
      const hasNext = !(shift >>> 7 == 0 && hi == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
    const hasMoreBits = !(hi >> 3 == 0);
    buf[pos++] = (hasMoreBits ? splitBits | 128 : splitBits) & 255;
    if (!hasMoreBits) {
      this.pos = pos;
      return this;
    }
    for (let i = 3; i < 31; i = i + 7) {
      const shift = hi >>> i;
      const hasNext = !(shift >>> 7 == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    buf[pos++] = hi >>> 31 & 1;
    this.pos = pos;
    return this;
  }
};
var INITIAL_SIZE = 128;
var DEFAULT_LEN_PREFIX_SIZE = 1;
var EMPTY_BUFFER = new Uint8Array(0);
var EMPTY_VIEW = new DataView(EMPTY_BUFFER.buffer);
var ASCII_MAX_LENGTH = 32;
function varint32Size(value) {
  if (value < 128)
    return 1;
  if (value < 16384)
    return 2;
  if (value < 2097152)
    return 3;
  if (value < 268435456)
    return 4;
  return 5;
}
var BinaryReader = class {
  constructor(buf, decodeUtf8 = getTextEncoding().decodeUtf8) {
    this.decodeUtf8 = decodeUtf8;
    this.varint64Lo = 0;
    this.varint64Hi = 0;
    this.varint64 = varint64read;
    this.uint32 = varint32read;
    this.buf = buf;
    this.len = buf.length;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  /**
   * Reads a tag - field number and wire type. Tags are uint32 varints; values
   * that do not fit in uint32 are rejected.
   */
  tag() {
    const start = this.pos;
    const tag = this.uint32();
    const bytesRead = this.pos - start;
    if (bytesRead > 5 || bytesRead == 5 && this.buf[this.pos - 1] > 15) {
      throw new Error("illegal tag: varint overflows uint32");
    }
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo <= 0 || wireType > 5) {
      throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
    }
    return [fieldNo, wireType];
  }
  /**
   * Skip one element and return the skipped data.
   *
   * When skipping StartGroup, provide the tags field number to check for
   * matching field number in the EndGroup tag. Recursion into nested groups
   * is guarded by the `recursionLimit` argument: When the limit is reached,
   * this method throws.
   */
  skip(wireType, fieldNo, recursionLimit = 100) {
    let start = this.pos;
    switch (wireType) {
      case WireType.Varint:
        while (this.buf[this.pos++] & 128) {
        }
        break;
      // @ts-ignore TS7029: Fallthrough case in switch -- ignore instead of expect-error for compiler settings without noFallthroughCasesInSwitch: true
      case WireType.Bit64:
        this.pos += 4;
      case WireType.Bit32:
        this.pos += 4;
        break;
      case WireType.LengthDelimited:
        let len = this.uint32();
        this.pos += len;
        break;
      case WireType.StartGroup:
        if (recursionLimit <= 0) {
          throw new Error("maximum recursion depth reached");
        }
        for (; ; ) {
          const [fn, wt] = this.tag();
          if (wt === WireType.EndGroup) {
            if (fieldNo !== void 0 && fn !== fieldNo) {
              throw new Error("invalid end group tag");
            }
            break;
          }
          this.skip(wt, fn, recursionLimit - 1);
        }
        break;
      default:
        throw new Error("cant skip wire type " + wireType);
    }
    this.assertBounds();
    return this.buf.subarray(start, this.pos);
  }
  /**
   * Throws error if position in byte array is out of range.
   */
  assertBounds() {
    if (this.pos > this.len)
      throw new RangeError("premature EOF");
  }
  /**
   * Read a `int32` field, a signed 32 bit varint.
   */
  int32() {
    return this.uint32() | 0;
  }
  /**
   * Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
   */
  sint32() {
    let zze = this.uint32();
    return zze >>> 1 ^ -(zze & 1);
  }
  /**
   * Read a `int64` field, a signed 64-bit varint.
   */
  int64() {
    this.varint64();
    return protoInt64.dec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `uint64` field, an unsigned 64-bit varint.
   */
  uint64() {
    this.varint64();
    return protoInt64.uDec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64() {
    this.varint64();
    let lo = this.varint64Lo;
    let hi = this.varint64Hi;
    let s = -(lo & 1);
    lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
    hi = hi >>> 1 ^ s;
    return protoInt64.dec(lo, hi);
  }
  /**
   * Read a `bool` field, a variant.
   */
  bool() {
    const b = this.buf[this.pos];
    if (b < 128) {
      this.pos++;
      return b !== 0;
    }
    this.varint64();
    return this.varint64Lo !== 0 || this.varint64Hi !== 0;
  }
  /**
   * Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
   */
  fixed32() {
    return this.view.getUint32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
   */
  sfixed32() {
    return this.view.getInt32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
   */
  fixed64() {
    return protoInt64.uDec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `fixed64` field, a signed, fixed-length 64-bit integer.
   */
  sfixed64() {
    return protoInt64.dec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `float` field, 32-bit floating point number.
   */
  float() {
    return this.view.getFloat32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `double` field, a 64-bit floating point number.
   */
  double() {
    return this.view.getFloat64((this.pos += 8) - 8, true);
  }
  /**
   * Read a `bytes` field, length-delimited arbitrary data.
   */
  bytes() {
    let len = this.uint32(), start = this.pos;
    this.pos += len;
    this.assertBounds();
    return this.buf.subarray(start, start + len);
  }
  /**
   * Read a `string` field, length-delimited data converted to UTF-8 text. If
   * `strict` is true, throw on invalid UTF-8 instead of substituting U+FFFD.
   */
  string(strict) {
    const len = this.uint32();
    const start = this.pos;
    this.pos += len;
    this.assertBounds();
    const buf = this.buf;
    if (len <= ASCII_MAX_LENGTH) {
      const codes = new Array(len);
      for (let i = 0; i < len; i++) {
        const byte = buf[start + i];
        if (byte > 127) {
          return this.decodeUtf8(buf.subarray(start, this.pos), strict);
        }
        codes[i] = byte;
      }
      return String.fromCharCode.apply(String, codes);
    }
    return this.decodeUtf8(buf.subarray(start, this.pos), strict);
  }
};
function assertInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid int32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN)
    throw new Error("invalid int32: " + arg);
}
function assertUInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid uint32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0)
    throw new Error("invalid uint32: " + arg);
}
function assertFloat32(arg) {
  if (typeof arg == "string") {
    const o = arg;
    arg = Number(arg);
    if (Number.isNaN(arg) && o !== "NaN") {
      throw new Error("invalid float32: " + o);
    }
  } else if (typeof arg != "number") {
    throw new Error("invalid float32: " + typeof arg);
  }
  if (!Number.isFinite(Math.fround(arg)) && Number.isFinite(arg)) {
    throw new Error("invalid float32: " + arg);
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/reflect-check.js
function checkField(field, value) {
  const check = field.fieldKind == "list" ? isReflectList(value, field) : field.fieldKind == "map" ? isReflectMap(value, field) : checkSingular(field, value);
  if (check === true) {
    return void 0;
  }
  let reason;
  switch (field.fieldKind) {
    case "list":
      reason = `expected ${formatReflectList(field)}, got ${formatVal(value)}`;
      break;
    case "map":
      reason = `expected ${formatReflectMap(field)}, got ${formatVal(value)}`;
      break;
    default: {
      reason = reasonSingular(field, value, check);
    }
  }
  return new FieldError(field, reason);
}
function checkListItem(field, index, value) {
  const check = checkSingular(field, value);
  if (check !== true) {
    return new FieldError(field, `list item #${index + 1}: ${reasonSingular(field, value, check)}`);
  }
  return void 0;
}
function checkMapEntry(field, key, value) {
  const checkKey = checkScalarValue(field.mapKey)(key);
  if (checkKey !== true) {
    return new FieldError(field, `invalid map key: ${reasonSingular({ scalar: field.mapKey }, key, checkKey)}`);
  }
  const checkVal = checkSingular(field, value);
  if (checkVal !== true) {
    return new FieldError(field, `map entry ${formatVal(key)}: ${reasonSingular(field, value, checkVal)}`);
  }
  return void 0;
}
function checkSingular(field, value) {
  if (field.scalar !== void 0) {
    return checkScalarValue(field.scalar)(value);
  }
  if (field.enum !== void 0) {
    if (field.enum.open) {
      return checkScalarValue(ScalarType.INT32)(value);
    }
    return field.enum.values.some((v) => v.number === value);
  }
  return isReflectMessage(value, field.message);
}
function checkScalarValue(scalar) {
  switch (scalar) {
    case ScalarType.DOUBLE:
      return (value) => typeof value == "number";
    case ScalarType.FLOAT:
      return (value) => {
        if (typeof value != "number") {
          return false;
        }
        if (!Number.isFinite(Math.fround(value)) && Number.isFinite(value)) {
          return `${value.toFixed()} out of range`;
        }
        return true;
      };
    case ScalarType.INT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return (value) => {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return false;
        }
        if (value > INT32_MAX || value < INT32_MIN) {
          return `${value.toFixed()} out of range`;
        }
        return true;
      };
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
      return (value) => {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return false;
        }
        if (value > UINT32_MAX || value < 0) {
          return `${value.toFixed()} out of range`;
        }
        return true;
      };
    case ScalarType.BOOL:
      return (value) => typeof value == "boolean";
    case ScalarType.STRING:
      return (value) => {
        if (typeof value != "string") {
          return false;
        }
        return getTextEncoding().checkUtf8(value) || "invalid UTF8";
      };
    case ScalarType.BYTES:
      return (value) => value instanceof Uint8Array;
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return (value) => {
        if (typeof value == "bigint" || typeof value == "number" || typeof value == "string" && value.length > 0) {
          try {
            protoInt64.parse(value);
            return true;
          } catch (_) {
            return `${value} out of range`;
          }
        }
        return false;
      };
    case ScalarType.FIXED64:
    case ScalarType.UINT64:
      return (value) => {
        if (typeof value == "bigint" || typeof value == "number" || typeof value == "string" && value.length > 0) {
          try {
            protoInt64.uParse(value);
            return true;
          } catch (_) {
            return `${value} out of range`;
          }
        }
        return false;
      };
  }
}
function reasonSingular(field, val, details) {
  details = typeof details == "string" ? `: ${details}` : `, got ${formatVal(val)}`;
  if (field.scalar !== void 0) {
    return `expected ${scalarTypeDescription(field.scalar)}` + details;
  }
  if (field.enum !== void 0) {
    return `expected ${field.enum.toString()}` + details;
  }
  return `expected ${formatReflectMessage(field.message)}` + details;
}
function formatVal(val) {
  switch (typeof val) {
    case "object":
      if (val === null) {
        return "null";
      }
      if (val instanceof Uint8Array) {
        return `Uint8Array(${val.length})`;
      }
      if (Array.isArray(val)) {
        return `Array(${val.length})`;
      }
      if (isReflectList(val)) {
        return formatReflectList(val.field());
      }
      if (isReflectMap(val)) {
        return formatReflectMap(val.field());
      }
      if (isReflectMessage(val)) {
        return formatReflectMessage(val.desc);
      }
      if (isMessage(val)) {
        return `message ${val.$typeName}`;
      }
      return "object";
    case "string":
      return val.length > 30 ? "string" : `"${val.split('"').join('\\"')}"`;
    case "boolean":
      return String(val);
    case "number":
      return String(val);
    case "bigint":
      return String(val) + "n";
    default:
      return typeof val;
  }
}
function formatReflectMessage(desc) {
  return `ReflectMessage (${desc.typeName})`;
}
function formatReflectList(field) {
  switch (field.listKind) {
    case "message":
      return `ReflectList (${field.message.toString()})`;
    case "enum":
      return `ReflectList (${field.enum.toString()})`;
    case "scalar":
      return `ReflectList (${ScalarType[field.scalar]})`;
  }
}
function formatReflectMap(field) {
  switch (field.mapKind) {
    case "message":
      return `ReflectMap (${ScalarType[field.mapKey]}, ${field.message.toString()})`;
    case "enum":
      return `ReflectMap (${ScalarType[field.mapKey]}, ${field.enum.toString()})`;
    case "scalar":
      return `ReflectMap (${ScalarType[field.mapKey]}, ${ScalarType[field.scalar]})`;
  }
}
function scalarTypeDescription(scalar) {
  switch (scalar) {
    case ScalarType.STRING:
      return "string";
    case ScalarType.BOOL:
      return "boolean";
    case ScalarType.INT64:
    case ScalarType.SINT64:
    case ScalarType.SFIXED64:
      return "bigint (int64)";
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return "bigint (uint64)";
    case ScalarType.BYTES:
      return "Uint8Array";
    case ScalarType.DOUBLE:
      return "number (float64)";
    case ScalarType.FLOAT:
      return "number (float32)";
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
      return "number (uint32)";
    case ScalarType.INT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return "number (int32)";
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/message.js
var NULL_VALUE = 0;
function localMessageMapper(field) {
  if (usesJsonRepresentation(field)) {
    return {
      toMessage: (local) => wktStructToReflect(local),
      toLocal: (message) => wktStructToLocal(message)
    };
  }
  if (field.fieldKind == "message" && !field.oneof && isWrapperDesc(field.message)) {
    const wrapperDesc = field.message;
    const valueLocalName = wrapperDesc.fields[0].localName;
    return {
      toMessage: (local) => {
        const message = create(wrapperDesc);
        if (local !== void 0) {
          message[valueLocalName] = local;
        }
        return message;
      },
      toLocal: (message) => message[valueLocalName]
    };
  }
  const childDesc = field.message;
  return {
    toMessage: (local) => local === void 0 ? create(childDesc) : local,
    toLocal: (message) => message
  };
}
function usesJsonRepresentation(field) {
  return field.message.typeName == "google.protobuf.Struct" && field.parent.typeName != "google.protobuf.Value";
}
function wktStructToReflect(json) {
  const struct = {
    $typeName: "google.protobuf.Struct",
    fields: {}
  };
  if (isObject(json)) {
    for (const k of Object.keys(json)) {
      setOwn(struct.fields, k, wktValueToReflect(json[k]));
    }
  }
  return struct;
}
function wktStructToLocal(val) {
  const json = {};
  for (const k of Object.keys(val.fields)) {
    setOwn(json, k, wktValueToLocal(val.fields[k]));
  }
  return json;
}
function wktValueToLocal(val) {
  switch (val.kind.case) {
    case "structValue":
      return wktStructToLocal(val.kind.value);
    case "listValue":
      return val.kind.value.values.map(wktValueToLocal);
    case "nullValue":
    case void 0:
      return null;
    default:
      return val.kind.value;
  }
}
function wktValueToReflect(json) {
  const value = {
    $typeName: "google.protobuf.Value",
    kind: { case: void 0 }
  };
  switch (typeof json) {
    case "number":
      value.kind = { case: "numberValue", value: json };
      break;
    case "string":
      value.kind = { case: "stringValue", value: json };
      break;
    case "boolean":
      value.kind = { case: "boolValue", value: json };
      break;
    case "object":
      if (json === null) {
        value.kind = { case: "nullValue", value: NULL_VALUE };
      } else if (Array.isArray(json)) {
        const listValue = {
          $typeName: "google.protobuf.ListValue",
          values: []
        };
        if (Array.isArray(json)) {
          for (const e of json) {
            listValue.values.push(wktValueToReflect(e));
          }
        }
        value.kind = {
          case: "listValue",
          value: listValue
        };
      } else {
        value.kind = {
          case: "structValue",
          value: wktStructToReflect(json)
        };
      }
      break;
  }
  return value;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/reflect.js
function reflect(messageDesc2, message, check = true) {
  return new ReflectMessageImpl(messageDesc2, message, check);
}
var messageSortedFields = /* @__PURE__ */ new WeakMap();
var ReflectMessageImpl = class {
  get sortedFields() {
    const cached = messageSortedFields.get(this.desc);
    if (cached) {
      return cached;
    }
    const sortedFields = this.desc.fields.concat().sort((a, b) => a.number - b.number);
    messageSortedFields.set(this.desc, sortedFields);
    return sortedFields;
  }
  constructor(messageDesc2, message, check = true) {
    this.lists = /* @__PURE__ */ new Map();
    this.maps = /* @__PURE__ */ new Map();
    this.check = check;
    this.desc = messageDesc2;
    this.message = this[unsafeLocal] = message !== null && message !== void 0 ? message : create(messageDesc2);
    this.fields = messageDesc2.fields;
    this.oneofs = messageDesc2.oneofs;
    this.members = messageDesc2.members;
  }
  findNumber(number) {
    if (!this._fieldsByNumber) {
      this._fieldsByNumber = new Map(this.desc.fields.map((f) => [f.number, f]));
    }
    return this._fieldsByNumber.get(number);
  }
  oneofCase(oneof) {
    assertOwn(this.message, oneof);
    return unsafeOneofCase(this.message, oneof);
  }
  isSet(field) {
    assertOwn(this.message, field);
    return unsafeIsSet(this.message, field);
  }
  clear(field) {
    assertOwn(this.message, field);
    unsafeClear(this.message, field);
  }
  get(field) {
    assertOwn(this.message, field);
    const value = unsafeGet(this.message, field);
    switch (field.fieldKind) {
      case "list":
        let list = this.lists.get(field);
        if (!list || list[unsafeLocal] !== value) {
          this.lists.set(
            field,
            // biome-ignore lint/suspicious/noAssignInExpressions: no
            list = new ReflectListImpl(field, value, this.check)
          );
        }
        return list;
      case "map":
        let map = this.maps.get(field);
        if (!map || map[unsafeLocal] !== value) {
          this.maps.set(
            field,
            // biome-ignore lint/suspicious/noAssignInExpressions: no
            map = new ReflectMapImpl(field, value, this.check)
          );
        }
        return map;
      case "message":
        return messageToReflect(field, value, this.check);
      case "scalar":
        return value === void 0 ? scalarZeroValue(field.scalar, false) : longToReflect(field, value);
      case "enum":
        return value !== null && value !== void 0 ? value : field.enum.values[0].number;
    }
  }
  set(field, value) {
    assertOwn(this.message, field);
    if (this.check) {
      const err = checkField(field, value);
      if (err) {
        throw err;
      }
    }
    let local;
    if (field.fieldKind == "message") {
      local = messageToLocal(field, value);
    } else if (isReflectMap(value) || isReflectList(value)) {
      local = value[unsafeLocal];
    } else {
      local = longToLocal(field, value);
    }
    unsafeSet(this.message, field, local);
  }
  getUnknown() {
    return this.message.$unknown;
  }
  setUnknown(value) {
    this.message.$unknown = value;
  }
};
function assertOwn(owner, member) {
  if (member.parent.typeName !== owner.$typeName) {
    throw new FieldError(member, `cannot use ${member.toString()} with message ${owner.$typeName}`, "ForeignFieldError");
  }
}
var ReflectListImpl = class {
  field() {
    return this._field;
  }
  get size() {
    return this._arr.length;
  }
  constructor(field, unsafeInput, check) {
    this._field = field;
    this._arr = this[unsafeLocal] = unsafeInput;
    this.check = check;
  }
  get(index) {
    const item = this._arr[index];
    return item === void 0 ? void 0 : listItemToReflect(this._field, item, this.check);
  }
  set(index, item) {
    if (index < 0 || index >= this._arr.length) {
      throw new FieldError(this._field, `list item #${index + 1}: out of range`);
    }
    if (this.check) {
      const err = checkListItem(this._field, index, item);
      if (err) {
        throw err;
      }
    }
    this._arr[index] = listItemToLocal(this._field, item);
  }
  add(item) {
    if (this.check) {
      const err = checkListItem(this._field, this._arr.length, item);
      if (err) {
        throw err;
      }
    }
    this._arr.push(listItemToLocal(this._field, item));
    return void 0;
  }
  clear() {
    this._arr.splice(0, this._arr.length);
  }
  [Symbol.iterator]() {
    return this.values();
  }
  keys() {
    return this._arr.keys();
  }
  *values() {
    for (const item of this._arr) {
      yield listItemToReflect(this._field, item, this.check);
    }
  }
  *entries() {
    for (let i = 0; i < this._arr.length; i++) {
      yield [i, listItemToReflect(this._field, this._arr[i], this.check)];
    }
  }
};
var ReflectMapImpl = class {
  constructor(field, unsafeInput, check = true) {
    this.obj = this[unsafeLocal] = unsafeInput !== null && unsafeInput !== void 0 ? unsafeInput : {};
    this.check = check;
    this._field = field;
  }
  field() {
    return this._field;
  }
  set(key, value) {
    if (this.check) {
      const err = checkMapEntry(this._field, key, value);
      if (err) {
        throw err;
      }
    }
    setOwn(this.obj, mapKeyToLocal(key), mapValueToLocal(this._field, value));
    return this;
  }
  delete(key) {
    const k = mapKeyToLocal(key);
    const has = Object.prototype.hasOwnProperty.call(this.obj, k);
    if (has) {
      delete this.obj[k];
    }
    return has;
  }
  clear() {
    for (const key of Object.keys(this.obj)) {
      delete this.obj[key];
    }
  }
  get(key) {
    let val = getOwn(this.obj, mapKeyToLocal(key));
    if (val !== void 0) {
      val = mapValueToReflect(this._field, val, this.check);
    }
    return val;
  }
  has(key) {
    return Object.prototype.hasOwnProperty.call(this.obj, mapKeyToLocal(key));
  }
  *keys() {
    for (const objKey of Object.keys(this.obj)) {
      yield mapKeyToReflect(objKey, this._field.mapKey);
    }
  }
  *entries() {
    for (const objEntry of Object.entries(this.obj)) {
      yield [
        mapKeyToReflect(objEntry[0], this._field.mapKey),
        mapValueToReflect(this._field, objEntry[1], this.check)
      ];
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get size() {
    return Object.keys(this.obj).length;
  }
  *values() {
    for (const val of Object.values(this.obj)) {
      yield mapValueToReflect(this._field, val, this.check);
    }
  }
  forEach(callbackfn, thisArg) {
    for (const mapEntry of this.entries()) {
      callbackfn.call(thisArg, mapEntry[1], mapEntry[0], this);
    }
  }
};
function messageToLocal(field, value) {
  if (!isReflectMessage(value)) {
    return value;
  }
  if (isWrapper(value.message) && !field.oneof && field.fieldKind == "message") {
    return value.message.value;
  }
  if (value.desc.typeName == "google.protobuf.Struct" && field.parent.typeName != "google.protobuf.Value") {
    return wktStructToLocal(value.message);
  }
  return value.message;
}
function messageToReflect(field, value, check) {
  if (value !== void 0) {
    if (isWrapperDesc(field.message) && !field.oneof && field.fieldKind == "message") {
      value = {
        $typeName: field.message.typeName,
        value: longToReflect(field.message.fields[0], value)
      };
    } else if (field.message.typeName == "google.protobuf.Struct" && field.parent.typeName != "google.protobuf.Value" && isObject(value)) {
      value = wktStructToReflect(value);
    }
  }
  return new ReflectMessageImpl(field.message, value, check);
}
function listItemToLocal(field, value) {
  if (field.listKind == "message") {
    return messageToLocal(field, value);
  }
  return longToLocal(field, value);
}
function listItemToReflect(field, value, check) {
  if (field.listKind == "message") {
    return messageToReflect(field, value, check);
  }
  return longToReflect(field, value);
}
function mapValueToLocal(field, value) {
  if (field.mapKind == "message") {
    return messageToLocal(field, value);
  }
  return longToLocal(field, value);
}
function mapValueToReflect(field, value, check) {
  if (field.mapKind == "message") {
    return messageToReflect(field, value, check);
  }
  return value;
}
function mapKeyToLocal(key) {
  return typeof key == "string" || typeof key == "number" ? key : String(key);
}
function mapKeyToReflect(key, type) {
  switch (type) {
    case ScalarType.STRING:
      return key;
    case ScalarType.INT32:
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32: {
      const n = Number.parseInt(key);
      if (Number.isFinite(n)) {
        return n;
      }
      break;
    }
    case ScalarType.BOOL:
      switch (key) {
        case "true":
          return true;
        case "false":
          return false;
      }
      break;
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      try {
        return protoInt64.uParse(key);
      } catch (_a) {
      }
      break;
    default:
      try {
        return protoInt64.parse(key);
      } catch (_b) {
      }
      break;
  }
  return key;
}
function longToReflect(field, value) {
  switch (field.scalar) {
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      if ("longAsString" in field && field.longAsString && typeof value == "string") {
        value = protoInt64.parse(value);
      }
      break;
    case ScalarType.FIXED64:
    case ScalarType.UINT64:
      if ("longAsString" in field && field.longAsString && typeof value == "string") {
        value = protoInt64.uParse(value);
      }
      break;
  }
  return value;
}
function longToLocal(field, value) {
  switch (field.scalar) {
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      if ("longAsString" in field && field.longAsString) {
        value = String(value);
      } else if (typeof value == "string" || typeof value == "number") {
        value = protoInt64.parse(value);
      }
      break;
    case ScalarType.FIXED64:
    case ScalarType.UINT64:
      if ("longAsString" in field && field.longAsString) {
        value = String(value);
      } else if (typeof value == "string" || typeof value == "number") {
        value = protoInt64.uParse(value);
      }
      break;
  }
  return value;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wire/base64-encoding.js
var nativeSetFromBase64 = Uint8Array.prototype.setFromBase64;
function base64Decode(base64Str) {
  const len = base64Str.length;
  let size = len - (len + 3 >> 2);
  if ((len & 3) == 0 && base64Str[len - 1] == "=") {
    size -= base64Str[len - 2] == "=" ? 2 : 1;
  }
  const bytes = new Uint8Array(size);
  let written = -1;
  if (nativeSetFromBase64) {
    try {
      const result = nativeSetFromBase64.call(bytes, base64Str);
      if (result.read == len) {
        written = result.written;
      }
    } catch (_a) {
    }
  }
  if (written < 0) {
    written = setFromBase64(bytes, base64Str);
  }
  return written == size ? bytes : bytes.subarray(0, written);
}
function setFromBase64(bytes, base64Str) {
  const table = getDecodeTable();
  let bytePos = 0, groupPos = 0, b, p = 0;
  for (let i = 0; i < base64Str.length; i++) {
    b = table[base64Str.charCodeAt(i)];
    if (b === void 0) {
      switch (base64Str[i]) {
        // @ts-ignore TS7029: Fallthrough case in switch -- ignore instead of expect-error for compiler settings without noFallthroughCasesInSwitch: true
        case "=":
          groupPos = 0;
        // reset state when padding found
        case "\n":
        case "\r":
        case "	":
        case " ":
          continue;
        // skip white-space, and padding
        default:
          throw Error("invalid base64 string");
      }
    }
    switch (groupPos) {
      case 0:
        p = b;
        groupPos = 1;
        break;
      case 1:
        bytes[bytePos++] = p << 2 | (b & 48) >> 4;
        p = b;
        groupPos = 2;
        break;
      case 2:
        bytes[bytePos++] = (p & 15) << 4 | (b & 60) >> 2;
        p = b;
        groupPos = 3;
        break;
      case 3:
        bytes[bytePos++] = (p & 3) << 6 | b;
        groupPos = 0;
        break;
    }
  }
  if (groupPos == 1)
    throw Error("invalid base64 string");
  return bytePos;
}
var nativeToBase64 = Uint8Array.prototype.toBase64;
var toBase64OptionsMap = {
  std: { alphabet: "base64", omitPadding: false },
  std_raw: { alphabet: "base64", omitPadding: true },
  url: { alphabet: "base64url", omitPadding: true }
};
function base64Encode(bytes, encoding = "std") {
  if (nativeToBase64) {
    return nativeToBase64.call(bytes, toBase64OptionsMap[encoding]);
  }
  const table = getEncodeTable(encoding);
  const pad2 = encoding == "std";
  let base64 = "", groupPos = 0, b, p = 0;
  for (let i = 0; i < bytes.length; i++) {
    b = bytes[i];
    switch (groupPos) {
      case 0:
        base64 += table[b >> 2];
        p = (b & 3) << 4;
        groupPos = 1;
        break;
      case 1:
        base64 += table[p | b >> 4];
        p = (b & 15) << 2;
        groupPos = 2;
        break;
      case 2:
        base64 += table[p | b >> 6];
        base64 += table[b & 63];
        groupPos = 0;
        break;
    }
  }
  if (groupPos) {
    base64 += table[p];
    if (pad2) {
      base64 += "=";
      if (groupPos == 1)
        base64 += "=";
    }
  }
  return base64;
}
var encodeTableStd;
var encodeTableUrl;
var decodeTable;
function getEncodeTable(encoding) {
  if (!encodeTableStd) {
    encodeTableStd = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
    encodeTableUrl = encodeTableStd.slice(0, -2).concat("-", "_");
  }
  return encoding == "url" ? (
    // biome-ignore lint/style/noNonNullAssertion: TS fails to narrow down
    encodeTableUrl
  ) : encodeTableStd;
}
function getDecodeTable() {
  if (!decodeTable) {
    decodeTable = [];
    const encodeTable = getEncodeTable("std");
    for (let i = 0; i < encodeTable.length; i++)
      decodeTable[encodeTable[i].charCodeAt(0)] = i;
    decodeTable["-".charCodeAt(0)] = encodeTable.indexOf("+");
    decodeTable["_".charCodeAt(0)] = encodeTable.indexOf("/");
  }
  return decodeTable;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/names.js
function protoCamelCase(snakeCase) {
  let capNext = false;
  const b = [];
  for (let i = 0; i < snakeCase.length; i++) {
    let c = snakeCase.charAt(i);
    switch (c) {
      case "_":
        capNext = true;
        break;
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        b.push(c);
        capNext = false;
        break;
      default:
        if (capNext) {
          capNext = false;
          c = c.toUpperCase();
        }
        b.push(c);
        break;
    }
  }
  return b.join("");
}
function protoSnakeCase(lowerCamelCase) {
  return lowerCamelCase.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
}
var reservedObjectProperties = /* @__PURE__ */ new Set([
  // names reserved by JavaScript
  "constructor",
  "toString",
  "toJSON",
  "valueOf"
]);
function safeObjectProperty(name) {
  return reservedObjectProperties.has(name) ? name + "$" : name;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/restore-json-names.js
function restoreJsonNames(message) {
  for (const f of message.field) {
    if (!unsafeIsSetExplicit(f, "jsonName")) {
      f.jsonName = protoCamelCase(f.name);
    }
  }
  message.nestedType.forEach(restoreJsonNames);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wire/text-format.js
function parseTextFormatEnumValue(descEnum, value) {
  const enumValue = descEnum.values.find((v) => v.name === value);
  if (!enumValue) {
    throw new Error(`cannot parse ${descEnum} default value: ${value}`);
  }
  return enumValue.number;
}
function parseTextFormatScalarValue(type, value) {
  switch (type) {
    case ScalarType.STRING:
      return value;
    case ScalarType.BYTES: {
      const u = unescapeBytesDefaultValue(value);
      if (u === false) {
        throw new Error(`cannot parse ${ScalarType[type]} default value: ${value}`);
      }
      return u;
    }
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return protoInt64.parse(value);
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return protoInt64.uParse(value);
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      switch (value) {
        case "inf":
          return Number.POSITIVE_INFINITY;
        case "-inf":
          return Number.NEGATIVE_INFINITY;
        case "nan":
          return Number.NaN;
        default:
          return parseFloat(value);
      }
    case ScalarType.BOOL:
      return value === "true";
    case ScalarType.INT32:
    case ScalarType.UINT32:
    case ScalarType.SINT32:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
      return parseInt(value, 10);
  }
}
function unescapeBytesDefaultValue(str) {
  const b = [];
  const input = {
    tail: str,
    c: "",
    next() {
      if (this.tail.length == 0) {
        return false;
      }
      this.c = this.tail[0];
      this.tail = this.tail.substring(1);
      return true;
    },
    take(n) {
      if (this.tail.length >= n) {
        const r = this.tail.substring(0, n);
        this.tail = this.tail.substring(n);
        return r;
      }
      return false;
    }
  };
  while (input.next()) {
    switch (input.c) {
      case "\\":
        if (input.next()) {
          switch (input.c) {
            case "\\":
              b.push(input.c.charCodeAt(0));
              break;
            case "b":
              b.push(8);
              break;
            case "f":
              b.push(12);
              break;
            case "n":
              b.push(10);
              break;
            case "r":
              b.push(13);
              break;
            case "t":
              b.push(9);
              break;
            case "v":
              b.push(11);
              break;
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7": {
              const s = input.c;
              const t = input.take(2);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 8);
              if (Number.isNaN(n)) {
                return false;
              }
              b.push(n);
              break;
            }
            case "x": {
              const s = input.c;
              const t = input.take(2);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 16);
              if (Number.isNaN(n)) {
                return false;
              }
              b.push(n);
              break;
            }
            case "u": {
              const s = input.c;
              const t = input.take(4);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 16);
              if (Number.isNaN(n)) {
                return false;
              }
              const chunk = new Uint8Array(4);
              const view = new DataView(chunk.buffer);
              view.setInt32(0, n, true);
              b.push(chunk[0], chunk[1], chunk[2], chunk[3]);
              break;
            }
            case "U": {
              const s = input.c;
              const t = input.take(8);
              if (t === false) {
                return false;
              }
              const tc = protoInt64.uEnc(s + t);
              const chunk = new Uint8Array(8);
              const view = new DataView(chunk.buffer);
              view.setInt32(0, tc.lo, true);
              view.setInt32(4, tc.hi, true);
              b.push(chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7]);
              break;
            }
          }
        }
        break;
      default:
        b.push(input.c.charCodeAt(0));
    }
  }
  return new Uint8Array(b);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/reflect/nested-types.js
function* nestedTypes(desc) {
  switch (desc.kind) {
    case "file":
      for (const message of desc.messages) {
        yield message;
        yield* nestedTypes(message);
      }
      yield* desc.enums;
      yield* desc.services;
      yield* desc.extensions;
      break;
    case "message":
      for (const message of desc.nestedMessages) {
        yield message;
        yield* nestedTypes(message);
      }
      yield* desc.nestedEnums;
      yield* desc.nestedExtensions;
      break;
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/registry.js
function createEmbeddedFileRegistry(fileDescriptorProto, resolve) {
  return buildFileRegistry([fileDescriptorProto, resolve]);
}
function buildFileRegistry(args, check) {
  const registry = createBaseRegistry();
  if (!args.length) {
    return registry;
  }
  if ("$typeName" in args[0] && args[0].$typeName == "google.protobuf.FileDescriptorSet") {
    for (const file of args[0].file) {
      check === null || check === void 0 ? void 0 : check(file);
      addFile(file, registry);
    }
    return registry;
  }
  if ("$typeName" in args[0]) {
    let recurseDeps = function(file) {
      const deps = [];
      for (const protoFileName of file.dependency) {
        if (registry.getFile(protoFileName) != void 0) {
          continue;
        }
        if (seen.has(protoFileName)) {
          continue;
        }
        const dep = resolve(protoFileName);
        if (!dep) {
          throw new Error(`Unable to resolve ${protoFileName}, imported by ${file.name}`);
        }
        if ("kind" in dep) {
          registry.addFile(dep, false, true);
        } else {
          seen.add(dep.name);
          deps.push(dep);
        }
      }
      return deps.concat(...deps.map(recurseDeps));
    };
    const input = args[0];
    const resolve = args[1];
    const seen = /* @__PURE__ */ new Set();
    for (const file of [input, ...recurseDeps(input)].reverse()) {
      check === null || check === void 0 ? void 0 : check(file);
      addFile(file, registry);
    }
  } else {
    for (const fileReg of args) {
      for (const file of fileReg.files) {
        registry.addFile(file);
      }
    }
  }
  return registry;
}
function createBaseRegistry() {
  const types = /* @__PURE__ */ new Map();
  const extendees = /* @__PURE__ */ new Map();
  const files = /* @__PURE__ */ new Map();
  return {
    kind: "registry",
    types,
    extendees,
    [Symbol.iterator]() {
      return types.values();
    },
    get files() {
      return files.values();
    },
    addFile(file, skipTypes, withDeps) {
      files.set(file.proto.name, file);
      if (!skipTypes) {
        for (const type of nestedTypes(file)) {
          this.add(type);
        }
      }
      if (withDeps) {
        for (const f of file.dependencies) {
          this.addFile(f, skipTypes, withDeps);
        }
      }
    },
    add(desc) {
      if (desc.kind == "extension") {
        let numberToExt = extendees.get(desc.extendee.typeName);
        if (!numberToExt) {
          extendees.set(
            desc.extendee.typeName,
            // biome-ignore lint/suspicious/noAssignInExpressions: no
            numberToExt = /* @__PURE__ */ new Map()
          );
        }
        numberToExt.set(desc.number, desc);
      }
      types.set(desc.typeName, desc);
    },
    get(typeName) {
      return types.get(typeName);
    },
    getFile(fileName) {
      return files.get(fileName);
    },
    getMessage(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "message" ? t : void 0;
    },
    getEnum(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "enum" ? t : void 0;
    },
    getExtension(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "extension" ? t : void 0;
    },
    getExtensionFor(extendee, no) {
      var _a;
      return (_a = extendees.get(extendee.typeName)) === null || _a === void 0 ? void 0 : _a.get(no);
    },
    getService(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "service" ? t : void 0;
    }
  };
}
var EDITION_PROTO22 = 998;
var EDITION_PROTO32 = 999;
var EDITION_UNSTABLE = 9999;
var TYPE_STRING = 9;
var TYPE_GROUP = 10;
var TYPE_MESSAGE = 11;
var TYPE_BYTES = 12;
var TYPE_ENUM = 14;
var LABEL_REPEATED = 3;
var LABEL_REQUIRED = 2;
var JS_STRING = 1;
var IDEMPOTENCY_UNKNOWN = 0;
var EXPLICIT = 1;
var IMPLICIT3 = 2;
var LEGACY_REQUIRED = 3;
var PACKED = 1;
var DELIMITED = 2;
var OPEN = 1;
var VERIFY = 2;
var maximumEdition = 1002;
var featureDefaults = {
  // EDITION_PROTO2
  998: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 2,
    // CLOSED,
    repeatedFieldEncoding: 2,
    // EXPANDED,
    utf8Validation: 3,
    // NONE,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 2,
    // LEGACY_BEST_EFFORT,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1,
    // EXPORT_ALL,
    enforceProtoLimits: 1
    // LEGACY_NO_EXPLICIT_LIMITS,
  },
  // EDITION_PROTO3
  999: {
    fieldPresence: 2,
    // IMPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1,
    // EXPORT_ALL,
    enforceProtoLimits: 1
    // LEGACY_NO_EXPLICIT_LIMITS,
  },
  // EDITION_2023
  1e3: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1,
    // EXPORT_ALL,
    enforceProtoLimits: 1
    // LEGACY_NO_EXPLICIT_LIMITS,
  },
  // EDITION_2024
  1001: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 1,
    // STYLE2024,
    defaultSymbolVisibility: 2,
    // EXPORT_TOP_LEVEL,
    enforceProtoLimits: 1
    // LEGACY_NO_EXPLICIT_LIMITS,
  },
  // EDITION_2026
  1002: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 3,
    // STYLE2026,
    defaultSymbolVisibility: 4,
    // STRICT,
    enforceProtoLimits: 2
    // PROTO_LIMITS2026,
  }
};
function addFile(proto, reg) {
  var _a, _b;
  const file = {
    kind: "file",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    edition: getFileEdition(proto),
    name: proto.name.replace(/\.proto$/, ""),
    dependencies: findFileDependencies(proto, reg),
    enums: [],
    messages: [],
    extensions: [],
    services: [],
    toString() {
      return `file ${proto.name}`;
    }
  };
  const mapEntriesStore = /* @__PURE__ */ new Map();
  const mapEntries = {
    get(typeName) {
      return mapEntriesStore.get(typeName);
    },
    add(desc) {
      var _a2;
      assert(((_a2 = desc.proto.options) === null || _a2 === void 0 ? void 0 : _a2.mapEntry) === true);
      mapEntriesStore.set(desc.typeName, desc);
    }
  };
  for (const enumProto of proto.enumType) {
    addEnum(enumProto, file, void 0, reg);
  }
  for (const messageProto of proto.messageType) {
    addMessage(messageProto, file, void 0, reg, mapEntries);
  }
  for (const serviceProto of proto.service) {
    addService(serviceProto, file, reg);
  }
  addExtensions(file, reg);
  for (const mapEntry of mapEntriesStore.values()) {
    addFields(mapEntry, reg, mapEntries);
  }
  for (const message of file.messages) {
    addFields(message, reg, mapEntries);
    addExtensions(message, reg);
  }
  reg.addFile(file, true);
}
function addExtensions(desc, reg) {
  switch (desc.kind) {
    case "file":
      for (const proto of desc.proto.extension) {
        const ext = newField(proto, desc, reg);
        desc.extensions.push(ext);
        reg.add(ext);
      }
      break;
    case "message":
      for (const proto of desc.proto.extension) {
        const ext = newField(proto, desc, reg);
        desc.nestedExtensions.push(ext);
        reg.add(ext);
      }
      for (const message of desc.nestedMessages) {
        addExtensions(message, reg);
      }
      break;
  }
}
function addFields(message, reg, mapEntries) {
  const allOneofs = message.proto.oneofDecl.map((proto) => newOneof(proto, message));
  const oneofsSeen = /* @__PURE__ */ new Set();
  for (const proto of message.proto.field) {
    const oneof = findOneof(proto, allOneofs);
    const field = newField(proto, message, reg, oneof, mapEntries);
    message.fields.push(field);
    message.field[field.localName] = field;
    if (oneof === void 0) {
      message.members.push(field);
    } else {
      oneof.fields.push(field);
      if (!oneofsSeen.has(oneof)) {
        oneofsSeen.add(oneof);
        message.members.push(oneof);
      }
    }
  }
  for (const oneof of allOneofs.filter((o) => oneofsSeen.has(o))) {
    message.oneofs.push(oneof);
  }
  for (const child of message.nestedMessages) {
    addFields(child, reg, mapEntries);
  }
}
function addEnum(proto, file, parent, reg) {
  var _a, _b, _c, _d, _e, _f, _g;
  var _h, _j;
  const sharedPrefix = findEnumSharedPrefix(proto.name, proto.value);
  const desc = {
    kind: "enum",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    parent,
    open: true,
    name: proto.name,
    typeName: makeTypeName(proto, parent, file),
    value: {},
    values: [],
    sharedPrefix,
    toString() {
      return `enum ${this.typeName}`;
    }
  };
  desc.open = isEnumOpen(desc);
  reg.add(desc);
  for (const p of proto.value) {
    const name = p.name;
    const value = {
      kind: "enum_value",
      proto: p,
      deprecated: (_d = (_c = p.options) === null || _c === void 0 ? void 0 : _c.deprecated) !== null && _d !== void 0 ? _d : false,
      parent: desc,
      name,
      localName: safeObjectProperty(sharedPrefix == void 0 ? name : name.substring(sharedPrefix.length)),
      number: p.number,
      jsonName: (_e = findEnumValueJsonName(p)) !== null && _e !== void 0 ? _e : name,
      toString() {
        return `enum value ${desc.typeName}.${name}`;
      }
    };
    desc.values.push(value);
    (_f = (_h = desc.value)[_j = p.number]) !== null && _f !== void 0 ? _f : _h[_j] = value;
  }
  ((_g = parent === null || parent === void 0 ? void 0 : parent.nestedEnums) !== null && _g !== void 0 ? _g : file.enums).push(desc);
}
function addMessage(proto, file, parent, reg, mapEntries) {
  var _a, _b, _c, _d;
  const desc = {
    kind: "message",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    parent,
    name: proto.name,
    typeName: makeTypeName(proto, parent, file),
    fields: [],
    field: {},
    oneofs: [],
    members: [],
    nestedEnums: [],
    nestedMessages: [],
    nestedExtensions: [],
    toString() {
      return `message ${this.typeName}`;
    }
  };
  if (((_c = proto.options) === null || _c === void 0 ? void 0 : _c.mapEntry) === true) {
    mapEntries.add(desc);
  } else {
    ((_d = parent === null || parent === void 0 ? void 0 : parent.nestedMessages) !== null && _d !== void 0 ? _d : file.messages).push(desc);
    reg.add(desc);
  }
  for (const enumProto of proto.enumType) {
    addEnum(enumProto, file, desc, reg);
  }
  for (const messageProto of proto.nestedType) {
    addMessage(messageProto, file, desc, reg, mapEntries);
  }
}
function addService(proto, file, reg) {
  var _a, _b;
  const desc = {
    kind: "service",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    name: proto.name,
    typeName: makeTypeName(proto, void 0, file),
    methods: [],
    method: {},
    toString() {
      return `service ${this.typeName}`;
    }
  };
  file.services.push(desc);
  reg.add(desc);
  for (const methodProto of proto.method) {
    const method = newMethod(methodProto, desc, reg);
    desc.methods.push(method);
    desc.method[method.localName] = method;
  }
}
function newMethod(proto, parent, reg) {
  var _a, _b, _c, _d;
  let methodKind;
  if (proto.clientStreaming && proto.serverStreaming) {
    methodKind = "bidi_streaming";
  } else if (proto.clientStreaming) {
    methodKind = "client_streaming";
  } else if (proto.serverStreaming) {
    methodKind = "server_streaming";
  } else {
    methodKind = "unary";
  }
  const input = reg.getMessage(trimLeadingDot(proto.inputType));
  const output = reg.getMessage(trimLeadingDot(proto.outputType));
  assert(input, `invalid MethodDescriptorProto: input_type ${proto.inputType} not found`);
  assert(output, `invalid MethodDescriptorProto: output_type ${proto.inputType} not found`);
  const name = proto.name;
  return {
    kind: "rpc",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    parent,
    name,
    localName: safeObjectProperty(name.length ? safeObjectProperty(name[0].toLowerCase() + name.substring(1)) : name),
    methodKind,
    input,
    output,
    idempotency: (_d = (_c = proto.options) === null || _c === void 0 ? void 0 : _c.idempotencyLevel) !== null && _d !== void 0 ? _d : IDEMPOTENCY_UNKNOWN,
    toString() {
      return `rpc ${parent.typeName}.${name}`;
    }
  };
}
function newOneof(proto, parent) {
  return {
    kind: "oneof",
    proto,
    deprecated: false,
    parent,
    fields: [],
    name: proto.name,
    localName: safeObjectProperty(protoCamelCase(proto.name)),
    toString() {
      return `oneof ${parent.typeName}.${this.name}`;
    }
  };
}
function newField(proto, parentOrFile, reg, oneof, mapEntries) {
  var _a, _b, _c;
  const isExtension = mapEntries === void 0;
  const field = {
    kind: "field",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    name: proto.name,
    number: proto.number,
    scalar: void 0,
    message: void 0,
    enum: void 0,
    presence: getFieldPresence(proto, oneof, isExtension, parentOrFile),
    utf8Validation: isUtf8Validated(proto, parentOrFile),
    listKind: void 0,
    mapKind: void 0,
    mapKey: void 0,
    delimitedEncoding: void 0,
    packed: void 0,
    longAsString: false,
    getDefaultValue: void 0
  };
  let toStr;
  if (isExtension) {
    const file = parentOrFile.kind == "file" ? parentOrFile : parentOrFile.file;
    const parent = parentOrFile.kind == "file" ? void 0 : parentOrFile;
    const typeName = makeTypeName(proto, parent, file);
    field.kind = "extension";
    field.file = file;
    field.parent = parent;
    field.oneof = void 0;
    field.typeName = typeName;
    field.jsonName = `[${typeName}]`;
    toStr = () => `extension ${typeName}`;
    const extendee = reg.getMessage(trimLeadingDot(proto.extendee));
    assert(extendee, `invalid FieldDescriptorProto: extendee ${proto.extendee} not found`);
    field.extendee = extendee;
  } else {
    const parent = parentOrFile;
    assert(parent.kind == "message");
    field.parent = parent;
    field.oneof = oneof;
    field.localName = oneof ? protoCamelCase(proto.name) : safeObjectProperty(protoCamelCase(proto.name));
    field.jsonName = proto.jsonName;
    toStr = () => `field ${parent.typeName}.${proto.name}`;
  }
  Object.defineProperty(field, "toString", {
    value: toStr,
    writable: true,
    enumerable: true,
    configurable: true
  });
  const label = proto.label;
  const type = proto.type;
  const jstype = (_c = proto.options) === null || _c === void 0 ? void 0 : _c.jstype;
  if (label === LABEL_REPEATED) {
    const mapEntry = type == TYPE_MESSAGE ? mapEntries === null || mapEntries === void 0 ? void 0 : mapEntries.get(trimLeadingDot(proto.typeName)) : void 0;
    if (mapEntry) {
      field.fieldKind = "map";
      const { key, value } = findMapEntryFields(mapEntry);
      field.mapKey = key.scalar;
      field.mapKind = value.fieldKind;
      field.message = value.message;
      field.delimitedEncoding = false;
      field.enum = value.enum;
      field.scalar = value.scalar;
      return field;
    }
    field.fieldKind = "list";
    switch (type) {
      case TYPE_MESSAGE:
      case TYPE_GROUP:
        field.listKind = "message";
        field.message = reg.getMessage(trimLeadingDot(proto.typeName));
        assert(field.message);
        field.delimitedEncoding = isDelimitedEncoding(proto, parentOrFile);
        break;
      case TYPE_ENUM:
        field.listKind = "enum";
        field.enum = reg.getEnum(trimLeadingDot(proto.typeName));
        assert(field.enum);
        break;
      default:
        field.listKind = "scalar";
        field.scalar = type;
        field.longAsString = jstype == JS_STRING;
        break;
    }
    field.packed = isPackedField(proto, parentOrFile);
    return field;
  }
  switch (type) {
    case TYPE_MESSAGE:
    case TYPE_GROUP:
      field.fieldKind = "message";
      field.message = reg.getMessage(trimLeadingDot(proto.typeName));
      assert(field.message, `invalid FieldDescriptorProto: type_name ${proto.typeName} not found`);
      field.delimitedEncoding = isDelimitedEncoding(proto, parentOrFile);
      field.getDefaultValue = () => void 0;
      break;
    case TYPE_ENUM: {
      const enumeration = reg.getEnum(trimLeadingDot(proto.typeName));
      assert(enumeration !== void 0, `invalid FieldDescriptorProto: type_name ${proto.typeName} not found`);
      field.fieldKind = "enum";
      field.enum = reg.getEnum(trimLeadingDot(proto.typeName));
      field.getDefaultValue = () => {
        return unsafeIsSetExplicit(proto, "defaultValue") ? parseTextFormatEnumValue(enumeration, proto.defaultValue) : void 0;
      };
      break;
    }
    default: {
      field.fieldKind = "scalar";
      field.scalar = type;
      field.longAsString = jstype == JS_STRING;
      field.getDefaultValue = () => {
        return unsafeIsSetExplicit(proto, "defaultValue") ? parseTextFormatScalarValue(type, proto.defaultValue) : void 0;
      };
      break;
    }
  }
  return field;
}
function getFileEdition(proto) {
  switch (proto.syntax) {
    case "":
    case "proto2":
      return EDITION_PROTO22;
    case "proto3":
      return EDITION_PROTO32;
    case "editions":
      if (proto.edition === EDITION_UNSTABLE) {
        return maximumEdition;
      }
      if (proto.edition in featureDefaults) {
        return proto.edition;
      }
      throw new Error(`${proto.name}: unsupported edition`);
    default:
      throw new Error(`${proto.name}: unsupported syntax "${proto.syntax}"`);
  }
}
function findFileDependencies(proto, reg) {
  return proto.dependency.map((wantName) => {
    const dep = reg.getFile(wantName);
    if (!dep) {
      throw new Error(`Cannot find ${wantName}, imported by ${proto.name}`);
    }
    return dep;
  });
}
function findEnumSharedPrefix(enumName, values) {
  const prefix = camelToSnakeCase(enumName) + "_";
  for (const value of values) {
    if (!value.name.toLowerCase().startsWith(prefix)) {
      return void 0;
    }
    const shortName = value.name.substring(prefix.length);
    if (shortName.length == 0) {
      return void 0;
    }
    if (/^\d/.test(shortName)) {
      return void 0;
    }
  }
  return prefix;
}
function findEnumValueJsonName(proto) {
  var _a, _b;
  const extensionNumber = 998;
  const fieldNumber = 1;
  let jsonName;
  for (const uf of (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.$unknown) !== null && _b !== void 0 ? _b : []) {
    if (uf.no !== extensionNumber || uf.wireType !== WireType.LengthDelimited) {
      continue;
    }
    const reader2 = new BinaryReader(new BinaryReader(uf.data).bytes());
    while (reader2.pos < reader2.len) {
      const [no, wireType] = reader2.tag();
      if (no === fieldNumber && wireType === WireType.LengthDelimited) {
        jsonName = reader2.string();
      } else {
        reader2.skip(wireType, no);
      }
    }
  }
  return jsonName;
}
function camelToSnakeCase(camel) {
  return (camel.substring(0, 1) + camel.substring(1).replace(/[A-Z]/g, (c) => "_" + c)).toLowerCase();
}
function makeTypeName(proto, parent, file) {
  let typeName;
  if (parent) {
    typeName = `${parent.typeName}.${proto.name}`;
  } else if (file.proto.package.length > 0) {
    typeName = `${file.proto.package}.${proto.name}`;
  } else {
    typeName = `${proto.name}`;
  }
  return typeName;
}
function trimLeadingDot(typeName) {
  return typeName.startsWith(".") ? typeName.substring(1) : typeName;
}
function findOneof(proto, allOneofs) {
  if (!unsafeIsSetExplicit(proto, "oneofIndex")) {
    return void 0;
  }
  if (proto.proto3Optional) {
    return void 0;
  }
  const oneof = allOneofs[proto.oneofIndex];
  assert(oneof, `invalid FieldDescriptorProto: oneof #${proto.oneofIndex} for field #${proto.number} not found`);
  return oneof;
}
function getFieldPresence(proto, oneof, isExtension, parent) {
  if (proto.label == LABEL_REQUIRED) {
    return LEGACY_REQUIRED;
  }
  if (proto.label == LABEL_REPEATED) {
    return IMPLICIT3;
  }
  if (!!oneof || proto.proto3Optional) {
    return EXPLICIT;
  }
  if (isExtension) {
    return EXPLICIT;
  }
  const resolved = resolveFeature("fieldPresence", { proto, parent });
  if (resolved == IMPLICIT3 && (proto.type == TYPE_MESSAGE || proto.type == TYPE_GROUP)) {
    return EXPLICIT;
  }
  return resolved;
}
function isPackedField(proto, parent) {
  if (proto.label != LABEL_REPEATED) {
    return false;
  }
  switch (proto.type) {
    case TYPE_STRING:
    case TYPE_BYTES:
    case TYPE_GROUP:
    case TYPE_MESSAGE:
      return false;
  }
  const o = proto.options;
  if (o && unsafeIsSetExplicit(o, "packed")) {
    return o.packed;
  }
  return PACKED == resolveFeature("repeatedFieldEncoding", {
    proto,
    parent
  });
}
function findMapEntryFields(mapEntry) {
  const key = mapEntry.fields.find((f) => f.number === 1);
  const value = mapEntry.fields.find((f) => f.number === 2);
  assert(key && key.fieldKind == "scalar" && key.scalar != ScalarType.BYTES && key.scalar != ScalarType.FLOAT && key.scalar != ScalarType.DOUBLE && value && value.fieldKind != "list" && value.fieldKind != "map");
  return { key, value };
}
function isEnumOpen(desc) {
  var _a;
  return OPEN == resolveFeature("enumType", {
    proto: desc.proto,
    parent: (_a = desc.parent) !== null && _a !== void 0 ? _a : desc.file
  });
}
function isDelimitedEncoding(proto, parent) {
  if (proto.type == TYPE_GROUP) {
    return true;
  }
  return DELIMITED == resolveFeature("messageEncoding", {
    proto,
    parent
  });
}
function isUtf8Validated(proto, parent) {
  return VERIFY == resolveFeature("utf8Validation", {
    proto,
    parent
  });
}
function resolveFeature(name, ref) {
  var _a, _b;
  const featureSet = (_a = ref.proto.options) === null || _a === void 0 ? void 0 : _a.features;
  if (featureSet) {
    const val = featureSet[name];
    if (val != 0) {
      return val;
    }
  }
  if ("kind" in ref) {
    if (ref.kind == "message") {
      return resolveFeature(name, (_b = ref.parent) !== null && _b !== void 0 ? _b : ref.file);
    }
    const editionDefaults = featureDefaults[ref.edition];
    if (!editionDefaults) {
      throw new Error(`feature default for edition ${ref.edition} not found`);
    }
    return editionDefaults[name];
  }
  return resolveFeature(name, ref.parent);
}
function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/boot.js
function boot(boot2) {
  const root = bootFileDescriptorProto(boot2);
  root.messageType.forEach(restoreJsonNames);
  const reg = createEmbeddedFileRegistry(root, () => void 0);
  return reg.getFile(root.name);
}
function bootFileDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    syntax: "",
    edition: 0
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FileDescriptorProto", dependency: [], publicDependency: [], weakDependency: [], optionDependency: [], service: [], extension: [] }, init), { messageType: init.messageType.map(bootDescriptorProto), enumType: init.enumType.map(bootEnumDescriptorProto) }));
}
function bootDescriptorProto(init) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const proto = /* @__PURE__ */ Object.create({
    visibility: 0
  });
  return Object.assign(proto, {
    $typeName: "google.protobuf.DescriptorProto",
    name: init.name,
    field: (_b = (_a = init.field) === null || _a === void 0 ? void 0 : _a.map(bootFieldDescriptorProto)) !== null && _b !== void 0 ? _b : [],
    extension: [],
    nestedType: (_d = (_c = init.nestedType) === null || _c === void 0 ? void 0 : _c.map(bootDescriptorProto)) !== null && _d !== void 0 ? _d : [],
    enumType: (_f = (_e = init.enumType) === null || _e === void 0 ? void 0 : _e.map(bootEnumDescriptorProto)) !== null && _f !== void 0 ? _f : [],
    extensionRange: (_h = (_g = init.extensionRange) === null || _g === void 0 ? void 0 : _g.map((e) => Object.assign({ $typeName: "google.protobuf.DescriptorProto.ExtensionRange" }, e))) !== null && _h !== void 0 ? _h : [],
    oneofDecl: [],
    reservedRange: [],
    reservedName: []
  });
}
function bootFieldDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    label: 1,
    typeName: "",
    extendee: "",
    defaultValue: "",
    oneofIndex: 0,
    jsonName: "",
    proto3Optional: false
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FieldDescriptorProto" }, init), { options: init.options ? bootFieldOptions(init.options) : void 0 }));
}
function bootFieldOptions(init) {
  var _a, _b, _c;
  const proto = /* @__PURE__ */ Object.create({
    ctype: 0,
    packed: false,
    jstype: 0,
    lazy: false,
    unverifiedLazy: false,
    deprecated: false,
    weak: false,
    debugRedact: false,
    retention: 0
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FieldOptions" }, init), { targets: (_a = init.targets) !== null && _a !== void 0 ? _a : [], editionDefaults: (_c = (_b = init.editionDefaults) === null || _b === void 0 ? void 0 : _b.map((e) => Object.assign({ $typeName: "google.protobuf.FieldOptions.EditionDefault" }, e))) !== null && _c !== void 0 ? _c : [], uninterpretedOption: [] }));
}
function bootEnumDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    visibility: 0
  });
  return Object.assign(proto, {
    $typeName: "google.protobuf.EnumDescriptorProto",
    name: init.name,
    reservedName: [],
    reservedRange: [],
    value: init.value.map((e) => Object.assign({ $typeName: "google.protobuf.EnumValueDescriptorProto" }, e))
  });
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/message.js
function messageDesc(file, path2, ...paths2) {
  return paths2.reduce((acc, cur) => acc.nestedMessages[cur], file.messages[path2]);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/enum.js
function enumDesc(file, path2, ...paths2) {
  if (paths2.length == 0) {
    return file.enums[path2];
  }
  const e = paths2.pop();
  return paths2.reduce((acc, cur) => acc.nestedMessages[cur], file.messages[path2]).nestedEnums[e];
}
function tsEnum(desc) {
  const enumObject = {};
  for (const value of desc.values) {
    enumObject[value.localName] = value.number;
    enumObject[value.number] = value.localName;
  }
  return enumObject;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/google/protobuf/descriptor_pb.js
var file_google_protobuf_descriptor = /* @__PURE__ */ boot({ "name": "google/protobuf/descriptor.proto", "package": "google.protobuf", "messageType": [{ "name": "FileDescriptorSet", "field": [{ "name": "file", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.FileDescriptorProto" }], "extensionRange": [{ "start": 536e6, "end": 536000001 }] }, { "name": "FileDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "package", "number": 2, "type": 9, "label": 1 }, { "name": "dependency", "number": 3, "type": 9, "label": 3 }, { "name": "public_dependency", "number": 10, "type": 5, "label": 3 }, { "name": "weak_dependency", "number": 11, "type": 5, "label": 3 }, { "name": "option_dependency", "number": 15, "type": 9, "label": 3 }, { "name": "message_type", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto" }, { "name": "enum_type", "number": 5, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto" }, { "name": "service", "number": 6, "type": 11, "label": 3, "typeName": ".google.protobuf.ServiceDescriptorProto" }, { "name": "extension", "number": 7, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "options", "number": 8, "type": 11, "label": 1, "typeName": ".google.protobuf.FileOptions" }, { "name": "source_code_info", "number": 9, "type": 11, "label": 1, "typeName": ".google.protobuf.SourceCodeInfo" }, { "name": "syntax", "number": 12, "type": 9, "label": 1 }, { "name": "edition", "number": 14, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }] }, { "name": "DescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "field", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "extension", "number": 6, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "nested_type", "number": 3, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto" }, { "name": "enum_type", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto" }, { "name": "extension_range", "number": 5, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto.ExtensionRange" }, { "name": "oneof_decl", "number": 8, "type": 11, "label": 3, "typeName": ".google.protobuf.OneofDescriptorProto" }, { "name": "options", "number": 7, "type": 11, "label": 1, "typeName": ".google.protobuf.MessageOptions" }, { "name": "reserved_range", "number": 9, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto.ReservedRange" }, { "name": "reserved_name", "number": 10, "type": 9, "label": 3 }, { "name": "visibility", "number": 11, "type": 14, "label": 1, "typeName": ".google.protobuf.SymbolVisibility" }], "nestedType": [{ "name": "ExtensionRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.ExtensionRangeOptions" }] }, { "name": "ReservedRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }] }] }, { "name": "ExtensionRangeOptions", "field": [{ "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }, { "name": "declaration", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.ExtensionRangeOptions.Declaration", "options": { "retention": 2 } }, { "name": "features", "number": 50, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "verification", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.ExtensionRangeOptions.VerificationState", "defaultValue": "UNVERIFIED", "options": { "retention": 2 } }], "nestedType": [{ "name": "Declaration", "field": [{ "name": "number", "number": 1, "type": 5, "label": 1 }, { "name": "full_name", "number": 2, "type": 9, "label": 1 }, { "name": "type", "number": 3, "type": 9, "label": 1 }, { "name": "reserved", "number": 5, "type": 8, "label": 1 }, { "name": "repeated", "number": 6, "type": 8, "label": 1 }] }], "enumType": [{ "name": "VerificationState", "value": [{ "name": "DECLARATION", "number": 0 }, { "name": "UNVERIFIED", "number": 1 }] }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "FieldDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "number", "number": 3, "type": 5, "label": 1 }, { "name": "label", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldDescriptorProto.Label" }, { "name": "type", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldDescriptorProto.Type" }, { "name": "type_name", "number": 6, "type": 9, "label": 1 }, { "name": "extendee", "number": 2, "type": 9, "label": 1 }, { "name": "default_value", "number": 7, "type": 9, "label": 1 }, { "name": "oneof_index", "number": 9, "type": 5, "label": 1 }, { "name": "json_name", "number": 10, "type": 9, "label": 1 }, { "name": "options", "number": 8, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions" }, { "name": "proto3_optional", "number": 17, "type": 8, "label": 1 }], "enumType": [{ "name": "Type", "value": [{ "name": "TYPE_DOUBLE", "number": 1 }, { "name": "TYPE_FLOAT", "number": 2 }, { "name": "TYPE_INT64", "number": 3 }, { "name": "TYPE_UINT64", "number": 4 }, { "name": "TYPE_INT32", "number": 5 }, { "name": "TYPE_FIXED64", "number": 6 }, { "name": "TYPE_FIXED32", "number": 7 }, { "name": "TYPE_BOOL", "number": 8 }, { "name": "TYPE_STRING", "number": 9 }, { "name": "TYPE_GROUP", "number": 10 }, { "name": "TYPE_MESSAGE", "number": 11 }, { "name": "TYPE_BYTES", "number": 12 }, { "name": "TYPE_UINT32", "number": 13 }, { "name": "TYPE_ENUM", "number": 14 }, { "name": "TYPE_SFIXED32", "number": 15 }, { "name": "TYPE_SFIXED64", "number": 16 }, { "name": "TYPE_SINT32", "number": 17 }, { "name": "TYPE_SINT64", "number": 18 }] }, { "name": "Label", "value": [{ "name": "LABEL_OPTIONAL", "number": 1 }, { "name": "LABEL_REPEATED", "number": 3 }, { "name": "LABEL_REQUIRED", "number": 2 }] }] }, { "name": "OneofDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "options", "number": 2, "type": 11, "label": 1, "typeName": ".google.protobuf.OneofOptions" }] }, { "name": "EnumDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "value", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumValueDescriptorProto" }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.EnumOptions" }, { "name": "reserved_range", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto.EnumReservedRange" }, { "name": "reserved_name", "number": 5, "type": 9, "label": 3 }, { "name": "visibility", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.SymbolVisibility" }], "nestedType": [{ "name": "EnumReservedRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }] }] }, { "name": "EnumValueDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "number", "number": 2, "type": 5, "label": 1 }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.EnumValueOptions" }] }, { "name": "ServiceDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "method", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.MethodDescriptorProto" }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.ServiceOptions" }] }, { "name": "MethodDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "input_type", "number": 2, "type": 9, "label": 1 }, { "name": "output_type", "number": 3, "type": 9, "label": 1 }, { "name": "options", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.MethodOptions" }, { "name": "client_streaming", "number": 5, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "server_streaming", "number": 6, "type": 8, "label": 1, "defaultValue": "false" }] }, { "name": "FileOptions", "field": [{ "name": "java_package", "number": 1, "type": 9, "label": 1 }, { "name": "java_outer_classname", "number": 8, "type": 9, "label": 1 }, { "name": "java_multiple_files", "number": 10, "type": 8, "label": 1, "defaultValue": "false", "options": {} }, { "name": "java_generate_equals_and_hash", "number": 20, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "java_string_check_utf8", "number": 27, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "optimize_for", "number": 9, "type": 14, "label": 1, "typeName": ".google.protobuf.FileOptions.OptimizeMode", "defaultValue": "SPEED" }, { "name": "go_package", "number": 11, "type": 9, "label": 1 }, { "name": "cc_generic_services", "number": 16, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "java_generic_services", "number": 17, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "py_generic_services", "number": 18, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 23, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "cc_enable_arenas", "number": 31, "type": 8, "label": 1, "defaultValue": "true", "options": {} }, { "name": "objc_class_prefix", "number": 36, "type": 9, "label": 1 }, { "name": "csharp_namespace", "number": 37, "type": 9, "label": 1 }, { "name": "swift_prefix", "number": 39, "type": 9, "label": 1 }, { "name": "php_class_prefix", "number": 40, "type": 9, "label": 1 }, { "name": "php_namespace", "number": 41, "type": 9, "label": 1 }, { "name": "php_metadata_namespace", "number": 44, "type": 9, "label": 1 }, { "name": "ruby_package", "number": 45, "type": 9, "label": 1 }, { "name": "features", "number": 50, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "enumType": [{ "name": "OptimizeMode", "value": [{ "name": "SPEED", "number": 1 }, { "name": "CODE_SIZE", "number": 2 }, { "name": "LITE_RUNTIME", "number": 3 }] }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "MessageOptions", "field": [{ "name": "message_set_wire_format", "number": 1, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "no_standard_descriptor_accessor", "number": 2, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "map_entry", "number": 7, "type": 8, "label": 1 }, { "name": "deprecated_legacy_json_field_conflicts", "number": 11, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "features", "number": 12, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "FieldOptions", "field": [{ "name": "ctype", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.CType", "defaultValue": "STRING" }, { "name": "packed", "number": 2, "type": 8, "label": 1 }, { "name": "jstype", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.JSType", "defaultValue": "JS_NORMAL" }, { "name": "lazy", "number": 5, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "unverified_lazy", "number": 15, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "weak", "number": 10, "type": 8, "label": 1, "defaultValue": "false", "options": { "deprecated": true } }, { "name": "debug_redact", "number": 16, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "retention", "number": 17, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.OptionRetention" }, { "name": "targets", "number": 19, "type": 14, "label": 3, "typeName": ".google.protobuf.FieldOptions.OptionTargetType" }, { "name": "edition_defaults", "number": 20, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldOptions.EditionDefault" }, { "name": "features", "number": 21, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "feature_support", "number": 22, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions.FeatureSupport" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "nestedType": [{ "name": "EditionDefault", "field": [{ "name": "edition", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "value", "number": 2, "type": 9, "label": 1 }] }, { "name": "FeatureSupport", "field": [{ "name": "edition_introduced", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "edition_deprecated", "number": 2, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "deprecation_warning", "number": 3, "type": 9, "label": 1 }, { "name": "edition_removed", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "removal_error", "number": 5, "type": 9, "label": 1 }] }], "enumType": [{ "name": "CType", "value": [{ "name": "STRING", "number": 0 }, { "name": "CORD", "number": 1 }, { "name": "STRING_PIECE", "number": 2 }] }, { "name": "JSType", "value": [{ "name": "JS_NORMAL", "number": 0 }, { "name": "JS_STRING", "number": 1 }, { "name": "JS_NUMBER", "number": 2 }] }, { "name": "OptionRetention", "value": [{ "name": "RETENTION_UNKNOWN", "number": 0 }, { "name": "RETENTION_RUNTIME", "number": 1 }, { "name": "RETENTION_SOURCE", "number": 2 }] }, { "name": "OptionTargetType", "value": [{ "name": "TARGET_TYPE_UNKNOWN", "number": 0 }, { "name": "TARGET_TYPE_FILE", "number": 1 }, { "name": "TARGET_TYPE_EXTENSION_RANGE", "number": 2 }, { "name": "TARGET_TYPE_MESSAGE", "number": 3 }, { "name": "TARGET_TYPE_FIELD", "number": 4 }, { "name": "TARGET_TYPE_ONEOF", "number": 5 }, { "name": "TARGET_TYPE_ENUM", "number": 6 }, { "name": "TARGET_TYPE_ENUM_ENTRY", "number": 7 }, { "name": "TARGET_TYPE_SERVICE", "number": 8 }, { "name": "TARGET_TYPE_METHOD", "number": 9 }] }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "OneofOptions", "field": [{ "name": "features", "number": 1, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "EnumOptions", "field": [{ "name": "allow_alias", "number": 2, "type": 8, "label": 1 }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated_legacy_json_field_conflicts", "number": 6, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "features", "number": 7, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "EnumValueOptions", "field": [{ "name": "deprecated", "number": 1, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "features", "number": 2, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "debug_redact", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "feature_support", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions.FeatureSupport" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "ServiceOptions", "field": [{ "name": "features", "number": 34, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "deprecated", "number": 33, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "MethodOptions", "field": [{ "name": "deprecated", "number": 33, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "idempotency_level", "number": 34, "type": 14, "label": 1, "typeName": ".google.protobuf.MethodOptions.IdempotencyLevel", "defaultValue": "IDEMPOTENCY_UNKNOWN" }, { "name": "features", "number": 35, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "enumType": [{ "name": "IdempotencyLevel", "value": [{ "name": "IDEMPOTENCY_UNKNOWN", "number": 0 }, { "name": "NO_SIDE_EFFECTS", "number": 1 }, { "name": "IDEMPOTENT", "number": 2 }] }], "extensionRange": [{ "start": 990, "end": 999 }, { "start": 1e3, "end": 536870912 }] }, { "name": "UninterpretedOption", "field": [{ "name": "name", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption.NamePart" }, { "name": "identifier_value", "number": 3, "type": 9, "label": 1 }, { "name": "positive_int_value", "number": 4, "type": 4, "label": 1 }, { "name": "negative_int_value", "number": 5, "type": 3, "label": 1 }, { "name": "double_value", "number": 6, "type": 1, "label": 1 }, { "name": "string_value", "number": 7, "type": 12, "label": 1 }, { "name": "aggregate_value", "number": 8, "type": 9, "label": 1 }], "nestedType": [{ "name": "NamePart", "field": [{ "name": "name_part", "number": 1, "type": 9, "label": 2 }, { "name": "is_extension", "number": 2, "type": 8, "label": 2 }] }] }, { "name": "FeatureSet", "field": [{ "name": "field_presence", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.FieldPresence", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "EXPLICIT", "edition": 900 }, { "value": "IMPLICIT", "edition": 999 }, { "value": "EXPLICIT", "edition": 1e3 }] } }, { "name": "enum_type", "number": 2, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.EnumType", "options": { "retention": 1, "targets": [6, 1], "editionDefaults": [{ "value": "CLOSED", "edition": 900 }, { "value": "OPEN", "edition": 999 }] } }, { "name": "repeated_field_encoding", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.RepeatedFieldEncoding", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "EXPANDED", "edition": 900 }, { "value": "PACKED", "edition": 999 }] } }, { "name": "utf8_validation", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.Utf8Validation", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "NONE", "edition": 900 }, { "value": "VERIFY", "edition": 999 }] } }, { "name": "message_encoding", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.MessageEncoding", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "LENGTH_PREFIXED", "edition": 900 }] } }, { "name": "json_format", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.JsonFormat", "options": { "retention": 1, "targets": [3, 6, 1], "editionDefaults": [{ "value": "LEGACY_BEST_EFFORT", "edition": 900 }, { "value": "ALLOW", "edition": 999 }] } }, { "name": "enforce_naming_style", "number": 7, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.EnforceNamingStyle", "options": { "retention": 2, "targets": [1, 2, 3, 4, 5, 6, 7, 8, 9], "editionDefaults": [{ "value": "STYLE_LEGACY", "edition": 900 }, { "value": "STYLE2024", "edition": 1001 }, { "value": "STYLE2026", "edition": 1002 }] } }, { "name": "default_symbol_visibility", "number": 8, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.VisibilityFeature.DefaultSymbolVisibility", "options": { "retention": 2, "targets": [1], "editionDefaults": [{ "value": "EXPORT_ALL", "edition": 900 }, { "value": "EXPORT_TOP_LEVEL", "edition": 1001 }, { "value": "STRICT", "edition": 1002 }] } }, { "name": "enforce_proto_limits", "number": 9, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.ProtoLimitsFeature.EnforceProtoLimits", "options": { "retention": 2, "targets": [6, 3, 4, 5], "editionDefaults": [{ "value": "LEGACY_NO_EXPLICIT_LIMITS", "edition": 900 }, { "value": "PROTO_LIMITS2026", "edition": 1002 }] } }], "nestedType": [{ "name": "VisibilityFeature", "enumType": [{ "name": "DefaultSymbolVisibility", "value": [{ "name": "DEFAULT_SYMBOL_VISIBILITY_UNKNOWN", "number": 0 }, { "name": "EXPORT_ALL", "number": 1 }, { "name": "EXPORT_TOP_LEVEL", "number": 2 }, { "name": "LOCAL_ALL", "number": 3 }, { "name": "STRICT", "number": 4 }] }] }, { "name": "ProtoLimitsFeature", "enumType": [{ "name": "EnforceProtoLimits", "value": [{ "name": "PROTO_LIMITS_UNKNOWN", "number": 0 }, { "name": "LEGACY_NO_EXPLICIT_LIMITS", "number": 1 }, { "name": "PROTO_LIMITS2026", "number": 2 }] }] }], "enumType": [{ "name": "FieldPresence", "value": [{ "name": "FIELD_PRESENCE_UNKNOWN", "number": 0 }, { "name": "EXPLICIT", "number": 1 }, { "name": "IMPLICIT", "number": 2 }, { "name": "LEGACY_REQUIRED", "number": 3 }] }, { "name": "EnumType", "value": [{ "name": "ENUM_TYPE_UNKNOWN", "number": 0 }, { "name": "OPEN", "number": 1 }, { "name": "CLOSED", "number": 2 }] }, { "name": "RepeatedFieldEncoding", "value": [{ "name": "REPEATED_FIELD_ENCODING_UNKNOWN", "number": 0 }, { "name": "PACKED", "number": 1 }, { "name": "EXPANDED", "number": 2 }] }, { "name": "Utf8Validation", "value": [{ "name": "UTF8_VALIDATION_UNKNOWN", "number": 0 }, { "name": "VERIFY", "number": 2 }, { "name": "NONE", "number": 3 }] }, { "name": "MessageEncoding", "value": [{ "name": "MESSAGE_ENCODING_UNKNOWN", "number": 0 }, { "name": "LENGTH_PREFIXED", "number": 1 }, { "name": "DELIMITED", "number": 2 }] }, { "name": "JsonFormat", "value": [{ "name": "JSON_FORMAT_UNKNOWN", "number": 0 }, { "name": "ALLOW", "number": 1 }, { "name": "LEGACY_BEST_EFFORT", "number": 2 }] }, { "name": "EnforceNamingStyle", "value": [{ "name": "ENFORCE_NAMING_STYLE_UNKNOWN", "number": 0 }, { "name": "STYLE2024", "number": 1 }, { "name": "STYLE_LEGACY", "number": 2 }, { "name": "STYLE2026", "number": 3 }] }], "extensionRange": [{ "start": 1e3, "end": 9995 }, { "start": 9995, "end": 1e4 }, { "start": 1e4, "end": 10001 }] }, { "name": "FeatureSetDefaults", "field": [{ "name": "defaults", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.FeatureSetDefaults.FeatureSetEditionDefault" }, { "name": "minimum_edition", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "maximum_edition", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }], "nestedType": [{ "name": "FeatureSetEditionDefault", "field": [{ "name": "edition", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "overridable_features", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "fixed_features", "number": 5, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }] }] }, { "name": "SourceCodeInfo", "field": [{ "name": "location", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.SourceCodeInfo.Location" }], "nestedType": [{ "name": "Location", "field": [{ "name": "path", "number": 1, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "span", "number": 2, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "leading_comments", "number": 3, "type": 9, "label": 1 }, { "name": "trailing_comments", "number": 4, "type": 9, "label": 1 }, { "name": "leading_detached_comments", "number": 6, "type": 9, "label": 3 }] }], "extensionRange": [{ "start": 536e6, "end": 536000001 }] }, { "name": "GeneratedCodeInfo", "field": [{ "name": "annotation", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.GeneratedCodeInfo.Annotation" }], "nestedType": [{ "name": "Annotation", "field": [{ "name": "path", "number": 1, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "source_file", "number": 2, "type": 9, "label": 1 }, { "name": "begin", "number": 3, "type": 5, "label": 1 }, { "name": "end", "number": 4, "type": 5, "label": 1 }, { "name": "semantic", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.GeneratedCodeInfo.Annotation.Semantic" }], "enumType": [{ "name": "Semantic", "value": [{ "name": "NONE", "number": 0 }, { "name": "SET", "number": 1 }, { "name": "ALIAS", "number": 2 }] }] }] }], "enumType": [{ "name": "Edition", "value": [{ "name": "EDITION_UNKNOWN", "number": 0 }, { "name": "EDITION_LEGACY", "number": 900 }, { "name": "EDITION_PROTO2", "number": 998 }, { "name": "EDITION_PROTO3", "number": 999 }, { "name": "EDITION_2023", "number": 1e3 }, { "name": "EDITION_2024", "number": 1001 }, { "name": "EDITION_2026", "number": 1002 }, { "name": "EDITION_UNSTABLE", "number": 9999 }, { "name": "EDITION_1_TEST_ONLY", "number": 1 }, { "name": "EDITION_2_TEST_ONLY", "number": 2 }, { "name": "EDITION_99997_TEST_ONLY", "number": 99997 }, { "name": "EDITION_99998_TEST_ONLY", "number": 99998 }, { "name": "EDITION_99999_TEST_ONLY", "number": 99999 }, { "name": "EDITION_MAX", "number": 2147483647 }] }, { "name": "SymbolVisibility", "value": [{ "name": "VISIBILITY_UNSET", "number": 0 }, { "name": "VISIBILITY_LOCAL", "number": 1 }, { "name": "VISIBILITY_EXPORT", "number": 2 }] }] });
var FileDescriptorProtoSchema = /* @__PURE__ */ messageDesc(file_google_protobuf_descriptor, 1);
var ExtensionRangeOptions_VerificationState;
(function(ExtensionRangeOptions_VerificationState2) {
  ExtensionRangeOptions_VerificationState2[ExtensionRangeOptions_VerificationState2["DECLARATION"] = 0] = "DECLARATION";
  ExtensionRangeOptions_VerificationState2[ExtensionRangeOptions_VerificationState2["UNVERIFIED"] = 1] = "UNVERIFIED";
})(ExtensionRangeOptions_VerificationState || (ExtensionRangeOptions_VerificationState = {}));
var FieldDescriptorProto_Type;
(function(FieldDescriptorProto_Type2) {
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["DOUBLE"] = 1] = "DOUBLE";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FLOAT"] = 2] = "FLOAT";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["INT64"] = 3] = "INT64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["UINT64"] = 4] = "UINT64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["INT32"] = 5] = "INT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FIXED64"] = 6] = "FIXED64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FIXED32"] = 7] = "FIXED32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["BOOL"] = 8] = "BOOL";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["STRING"] = 9] = "STRING";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["GROUP"] = 10] = "GROUP";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["MESSAGE"] = 11] = "MESSAGE";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["BYTES"] = 12] = "BYTES";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["UINT32"] = 13] = "UINT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["ENUM"] = 14] = "ENUM";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SFIXED32"] = 15] = "SFIXED32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SFIXED64"] = 16] = "SFIXED64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SINT32"] = 17] = "SINT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SINT64"] = 18] = "SINT64";
})(FieldDescriptorProto_Type || (FieldDescriptorProto_Type = {}));
var FieldDescriptorProto_Label;
(function(FieldDescriptorProto_Label2) {
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["OPTIONAL"] = 1] = "OPTIONAL";
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["REPEATED"] = 3] = "REPEATED";
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["REQUIRED"] = 2] = "REQUIRED";
})(FieldDescriptorProto_Label || (FieldDescriptorProto_Label = {}));
var FileOptions_OptimizeMode;
(function(FileOptions_OptimizeMode2) {
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["SPEED"] = 1] = "SPEED";
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["CODE_SIZE"] = 2] = "CODE_SIZE";
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["LITE_RUNTIME"] = 3] = "LITE_RUNTIME";
})(FileOptions_OptimizeMode || (FileOptions_OptimizeMode = {}));
var FieldOptions_CType;
(function(FieldOptions_CType2) {
  FieldOptions_CType2[FieldOptions_CType2["STRING"] = 0] = "STRING";
  FieldOptions_CType2[FieldOptions_CType2["CORD"] = 1] = "CORD";
  FieldOptions_CType2[FieldOptions_CType2["STRING_PIECE"] = 2] = "STRING_PIECE";
})(FieldOptions_CType || (FieldOptions_CType = {}));
var FieldOptions_JSType;
(function(FieldOptions_JSType2) {
  FieldOptions_JSType2[FieldOptions_JSType2["JS_NORMAL"] = 0] = "JS_NORMAL";
  FieldOptions_JSType2[FieldOptions_JSType2["JS_STRING"] = 1] = "JS_STRING";
  FieldOptions_JSType2[FieldOptions_JSType2["JS_NUMBER"] = 2] = "JS_NUMBER";
})(FieldOptions_JSType || (FieldOptions_JSType = {}));
var FieldOptions_OptionRetention;
(function(FieldOptions_OptionRetention2) {
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_UNKNOWN"] = 0] = "RETENTION_UNKNOWN";
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_RUNTIME"] = 1] = "RETENTION_RUNTIME";
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_SOURCE"] = 2] = "RETENTION_SOURCE";
})(FieldOptions_OptionRetention || (FieldOptions_OptionRetention = {}));
var FieldOptions_OptionTargetType;
(function(FieldOptions_OptionTargetType2) {
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_UNKNOWN"] = 0] = "TARGET_TYPE_UNKNOWN";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_FILE"] = 1] = "TARGET_TYPE_FILE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_EXTENSION_RANGE"] = 2] = "TARGET_TYPE_EXTENSION_RANGE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_MESSAGE"] = 3] = "TARGET_TYPE_MESSAGE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_FIELD"] = 4] = "TARGET_TYPE_FIELD";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ONEOF"] = 5] = "TARGET_TYPE_ONEOF";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ENUM"] = 6] = "TARGET_TYPE_ENUM";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ENUM_ENTRY"] = 7] = "TARGET_TYPE_ENUM_ENTRY";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_SERVICE"] = 8] = "TARGET_TYPE_SERVICE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_METHOD"] = 9] = "TARGET_TYPE_METHOD";
})(FieldOptions_OptionTargetType || (FieldOptions_OptionTargetType = {}));
var MethodOptions_IdempotencyLevel;
(function(MethodOptions_IdempotencyLevel2) {
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["IDEMPOTENCY_UNKNOWN"] = 0] = "IDEMPOTENCY_UNKNOWN";
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["NO_SIDE_EFFECTS"] = 1] = "NO_SIDE_EFFECTS";
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["IDEMPOTENT"] = 2] = "IDEMPOTENT";
})(MethodOptions_IdempotencyLevel || (MethodOptions_IdempotencyLevel = {}));
var FeatureSet_VisibilityFeature_DefaultSymbolVisibility;
(function(FeatureSet_VisibilityFeature_DefaultSymbolVisibility2) {
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["DEFAULT_SYMBOL_VISIBILITY_UNKNOWN"] = 0] = "DEFAULT_SYMBOL_VISIBILITY_UNKNOWN";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["EXPORT_ALL"] = 1] = "EXPORT_ALL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["EXPORT_TOP_LEVEL"] = 2] = "EXPORT_TOP_LEVEL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["LOCAL_ALL"] = 3] = "LOCAL_ALL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["STRICT"] = 4] = "STRICT";
})(FeatureSet_VisibilityFeature_DefaultSymbolVisibility || (FeatureSet_VisibilityFeature_DefaultSymbolVisibility = {}));
var FeatureSet_ProtoLimitsFeature_EnforceProtoLimits;
(function(FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2) {
  FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2[FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2["PROTO_LIMITS_UNKNOWN"] = 0] = "PROTO_LIMITS_UNKNOWN";
  FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2[FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2["LEGACY_NO_EXPLICIT_LIMITS"] = 1] = "LEGACY_NO_EXPLICIT_LIMITS";
  FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2[FeatureSet_ProtoLimitsFeature_EnforceProtoLimits2["PROTO_LIMITS2026"] = 2] = "PROTO_LIMITS2026";
})(FeatureSet_ProtoLimitsFeature_EnforceProtoLimits || (FeatureSet_ProtoLimitsFeature_EnforceProtoLimits = {}));
var FeatureSet_FieldPresence;
(function(FeatureSet_FieldPresence2) {
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["FIELD_PRESENCE_UNKNOWN"] = 0] = "FIELD_PRESENCE_UNKNOWN";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["EXPLICIT"] = 1] = "EXPLICIT";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["IMPLICIT"] = 2] = "IMPLICIT";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["LEGACY_REQUIRED"] = 3] = "LEGACY_REQUIRED";
})(FeatureSet_FieldPresence || (FeatureSet_FieldPresence = {}));
var FeatureSet_EnumType;
(function(FeatureSet_EnumType2) {
  FeatureSet_EnumType2[FeatureSet_EnumType2["ENUM_TYPE_UNKNOWN"] = 0] = "ENUM_TYPE_UNKNOWN";
  FeatureSet_EnumType2[FeatureSet_EnumType2["OPEN"] = 1] = "OPEN";
  FeatureSet_EnumType2[FeatureSet_EnumType2["CLOSED"] = 2] = "CLOSED";
})(FeatureSet_EnumType || (FeatureSet_EnumType = {}));
var FeatureSet_RepeatedFieldEncoding;
(function(FeatureSet_RepeatedFieldEncoding2) {
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["REPEATED_FIELD_ENCODING_UNKNOWN"] = 0] = "REPEATED_FIELD_ENCODING_UNKNOWN";
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["PACKED"] = 1] = "PACKED";
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["EXPANDED"] = 2] = "EXPANDED";
})(FeatureSet_RepeatedFieldEncoding || (FeatureSet_RepeatedFieldEncoding = {}));
var FeatureSet_Utf8Validation;
(function(FeatureSet_Utf8Validation2) {
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["UTF8_VALIDATION_UNKNOWN"] = 0] = "UTF8_VALIDATION_UNKNOWN";
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["VERIFY"] = 2] = "VERIFY";
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["NONE"] = 3] = "NONE";
})(FeatureSet_Utf8Validation || (FeatureSet_Utf8Validation = {}));
var FeatureSet_MessageEncoding;
(function(FeatureSet_MessageEncoding2) {
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["MESSAGE_ENCODING_UNKNOWN"] = 0] = "MESSAGE_ENCODING_UNKNOWN";
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["LENGTH_PREFIXED"] = 1] = "LENGTH_PREFIXED";
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["DELIMITED"] = 2] = "DELIMITED";
})(FeatureSet_MessageEncoding || (FeatureSet_MessageEncoding = {}));
var FeatureSet_JsonFormat;
(function(FeatureSet_JsonFormat2) {
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["JSON_FORMAT_UNKNOWN"] = 0] = "JSON_FORMAT_UNKNOWN";
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["ALLOW"] = 1] = "ALLOW";
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["LEGACY_BEST_EFFORT"] = 2] = "LEGACY_BEST_EFFORT";
})(FeatureSet_JsonFormat || (FeatureSet_JsonFormat = {}));
var FeatureSet_EnforceNamingStyle;
(function(FeatureSet_EnforceNamingStyle2) {
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["ENFORCE_NAMING_STYLE_UNKNOWN"] = 0] = "ENFORCE_NAMING_STYLE_UNKNOWN";
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["STYLE2024"] = 1] = "STYLE2024";
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["STYLE_LEGACY"] = 2] = "STYLE_LEGACY";
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["STYLE2026"] = 3] = "STYLE2026";
})(FeatureSet_EnforceNamingStyle || (FeatureSet_EnforceNamingStyle = {}));
var GeneratedCodeInfo_Annotation_Semantic;
(function(GeneratedCodeInfo_Annotation_Semantic2) {
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["NONE"] = 0] = "NONE";
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["SET"] = 1] = "SET";
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["ALIAS"] = 2] = "ALIAS";
})(GeneratedCodeInfo_Annotation_Semantic || (GeneratedCodeInfo_Annotation_Semantic = {}));
var Edition;
(function(Edition2) {
  Edition2[Edition2["EDITION_UNKNOWN"] = 0] = "EDITION_UNKNOWN";
  Edition2[Edition2["EDITION_LEGACY"] = 900] = "EDITION_LEGACY";
  Edition2[Edition2["EDITION_PROTO2"] = 998] = "EDITION_PROTO2";
  Edition2[Edition2["EDITION_PROTO3"] = 999] = "EDITION_PROTO3";
  Edition2[Edition2["EDITION_2023"] = 1e3] = "EDITION_2023";
  Edition2[Edition2["EDITION_2024"] = 1001] = "EDITION_2024";
  Edition2[Edition2["EDITION_2026"] = 1002] = "EDITION_2026";
  Edition2[Edition2["EDITION_UNSTABLE"] = 9999] = "EDITION_UNSTABLE";
  Edition2[Edition2["EDITION_1_TEST_ONLY"] = 1] = "EDITION_1_TEST_ONLY";
  Edition2[Edition2["EDITION_2_TEST_ONLY"] = 2] = "EDITION_2_TEST_ONLY";
  Edition2[Edition2["EDITION_99997_TEST_ONLY"] = 99997] = "EDITION_99997_TEST_ONLY";
  Edition2[Edition2["EDITION_99998_TEST_ONLY"] = 99998] = "EDITION_99998_TEST_ONLY";
  Edition2[Edition2["EDITION_99999_TEST_ONLY"] = 99999] = "EDITION_99999_TEST_ONLY";
  Edition2[Edition2["EDITION_MAX"] = 2147483647] = "EDITION_MAX";
})(Edition || (Edition = {}));
var SymbolVisibility;
(function(SymbolVisibility2) {
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_UNSET"] = 0] = "VISIBILITY_UNSET";
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_LOCAL"] = 1] = "VISIBILITY_LOCAL";
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_EXPORT"] = 2] = "VISIBILITY_EXPORT";
})(SymbolVisibility || (SymbolVisibility = {}));

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/from-binary.js
function makeReadContext(options) {
  return Object.assign(Object.assign({ readUnknownFields: true, recursionLimit: 100 }, options), { depth: 0 });
}
function fromBinary(schema2, bytes, options) {
  const message = create(schema2);
  compiledReader(schema2).read(message, new BinaryReader(bytes), makeReadContext(options), bytes.byteLength);
  return message;
}
var compiledReaders = /* @__PURE__ */ new WeakMap();
function compiledReader(desc) {
  let compiled = compiledReaders.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage(desc);
  }
  return compiled;
}
function compileMessage(desc) {
  const descString = String(desc);
  const fieldReaders = /* @__PURE__ */ new Map();
  const compiled = {
    read: compileMessageReader(descString, fieldReaders),
    readGroup: compileGroupReader(descString, fieldReaders)
  };
  compiledReaders.set(desc, compiled);
  for (const field of desc.fields) {
    fieldReaders.set(field.number, compileFieldReader(field));
  }
  return compiled;
}
function compileMessageReader(descString, fieldReaders) {
  return (message, reader2, ctx, length) => {
    var _a;
    if (++ctx.depth > ctx.recursionLimit) {
      throw new Error(`cannot decode ${descString} from binary: maximum recursion depth of ${ctx.recursionLimit} reached`);
    }
    const end = reader2.pos + length;
    const unknownFields = (_a = message.$unknown) !== null && _a !== void 0 ? _a : [];
    while (reader2.pos < end) {
      const [fieldNo, wireType] = reader2.tag();
      const fieldReader = fieldReaders.get(fieldNo);
      if (fieldReader === void 0) {
        const data = reader2.skip(wireType, fieldNo, ctx.recursionLimit - ctx.depth);
        if (ctx.readUnknownFields) {
          unknownFields.push({ no: fieldNo, wireType, data });
        }
        continue;
      }
      fieldReader(message, reader2, ctx, wireType);
    }
    if (unknownFields.length > 0) {
      message.$unknown = unknownFields;
    }
    ctx.depth--;
  };
}
function compileGroupReader(descString, fieldReaders) {
  return (message, reader2, ctx, fieldNo) => {
    var _a;
    if (++ctx.depth > ctx.recursionLimit) {
      throw new Error(`cannot decode ${descString} from binary: maximum recursion depth of ${ctx.recursionLimit} reached`);
    }
    let recordFieldNo;
    let wireType;
    const unknownFields = (_a = message.$unknown) !== null && _a !== void 0 ? _a : [];
    while (reader2.pos < reader2.len) {
      [recordFieldNo, wireType] = reader2.tag();
      if (wireType == WireType.EndGroup) {
        break;
      }
      const fieldReader = fieldReaders.get(recordFieldNo);
      if (fieldReader === void 0) {
        const data = reader2.skip(wireType, recordFieldNo, ctx.recursionLimit - ctx.depth);
        if (ctx.readUnknownFields) {
          unknownFields.push({ no: recordFieldNo, wireType, data });
        }
        continue;
      }
      fieldReader(message, reader2, ctx, wireType);
    }
    if (wireType != WireType.EndGroup || recordFieldNo !== fieldNo) {
      throw new Error("invalid end group tag");
    }
    if (unknownFields.length > 0) {
      message.$unknown = unknownFields;
    }
    ctx.depth--;
  };
}
function readField(message, reader2, field, wireType, ctx) {
  compileFieldReader(field)(message[unsafeLocal], reader2, ctx, wireType);
}
function compileFieldReader(field) {
  switch (field.fieldKind) {
    case "scalar":
      return compileScalarFieldReader(field);
    case "enum":
      return compileEnumFieldReader(field);
    case "message":
      return compileMessageFieldReader(field);
    case "list":
      return compileListFieldReader(field);
    case "map":
      return compileMapFieldReader(field);
  }
}
function compileScalarFieldReader(field) {
  const readScalar = compileScalarReader(field.scalar, field.utf8Validation, field.longAsString);
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, reader2) => {
      message[oneofLocalName] = {
        case: localName,
        value: readScalar(reader2)
      };
    };
  }
  return (message, reader2) => {
    message[localName] = readScalar(reader2);
  };
}
function compileEnumFieldReader(field) {
  var _a;
  const localName = field.localName;
  const oneofLocalName = (_a = field.oneof) === null || _a === void 0 ? void 0 : _a.localName;
  if (field.enum.open) {
    if (oneofLocalName !== void 0) {
      return (message, reader2) => {
        message[oneofLocalName] = { case: localName, value: reader2.int32() };
      };
    }
    return (message, reader2) => {
      message[localName] = reader2.int32();
    };
  }
  const values = field.enum.values;
  const fieldNo = field.number;
  return (message, reader2, ctx, wireType) => {
    var _a2;
    const val = reader2.int32();
    if (values.some((v) => v.number === val)) {
      if (oneofLocalName !== void 0) {
        message[oneofLocalName] = { case: localName, value: val };
      } else {
        message[localName] = val;
      }
    } else if (ctx.readUnknownFields) {
      const bytes = [];
      varint32write(val, bytes);
      const unknownFields = (_a2 = message.$unknown) !== null && _a2 !== void 0 ? _a2 : [];
      unknownFields.push({
        no: fieldNo,
        wireType,
        data: new Uint8Array(bytes)
      });
      message.$unknown = unknownFields;
    }
  };
}
function compileMessageFieldReader(field) {
  const localName = field.localName;
  const { toMessage, toLocal } = localMessageMapper(field);
  const readChild = compileChildReader(field);
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, reader2, ctx) => {
      const oneof = message[oneofLocalName];
      const child = toMessage(oneof.case === localName ? oneof.value : void 0);
      readChild(child, reader2, ctx);
      message[oneofLocalName] = { case: localName, value: toLocal(child) };
    };
  }
  return (message, reader2, ctx) => {
    const child = toMessage(message[localName]);
    readChild(child, reader2, ctx);
    message[localName] = toLocal(child);
  };
}
function compileChildReader(field) {
  const compiledChild = compiledReader(field.message);
  if (field.delimitedEncoding) {
    const fieldNo = field.number;
    return (child, reader2, ctx) => compiledChild.readGroup(child, reader2, ctx, fieldNo);
  }
  return (child, reader2, ctx) => compiledChild.read(child, reader2, ctx, reader2.uint32());
}
function compileListFieldReader(field) {
  const localName = field.localName;
  if (field.listKind == "message") {
    const { toMessage, toLocal } = localMessageMapper(field);
    const readChild = compileChildReader(field);
    return (message, reader2, ctx) => {
      const child = toMessage(void 0);
      readChild(child, reader2, ctx);
      message[localName].push(toLocal(child));
    };
  }
  const scalarType = field.listKind == "enum" ? ScalarType.INT32 : field.scalar;
  const longAsString = field.listKind == "scalar" ? field.longAsString : false;
  const readScalar = compileScalarReader(scalarType, field.utf8Validation, longAsString);
  const packedPossible = scalarType != ScalarType.STRING && scalarType != ScalarType.BYTES;
  return (message, reader2, ctx, wireType) => {
    const items = message[localName];
    if (wireType == WireType.LengthDelimited && packedPossible) {
      const end = reader2.uint32() + reader2.pos;
      while (reader2.pos < end) {
        items.push(readScalar(reader2));
      }
    } else {
      items.push(readScalar(reader2));
    }
  };
}
function compileMapFieldReader(field) {
  const localName = field.localName;
  const readKey = compileScalarReader(field.mapKey, field.utf8Validation, false);
  const keyZero = scalarZeroValue(field.mapKey, false);
  let readValue;
  let valueDefault;
  switch (field.mapKind) {
    case "scalar": {
      const scalar = field.scalar;
      const readScalar = compileScalarReader(scalar, field.utf8Validation, false);
      readValue = (reader2) => readScalar(reader2);
      if (scalar == ScalarType.BYTES) {
        valueDefault = () => new Uint8Array(0);
      } else {
        const zero = scalarZeroValue(scalar, false);
        valueDefault = () => zero;
      }
      break;
    }
    case "enum": {
      const zero = field.enum.values[0].number;
      readValue = (reader2) => reader2.int32();
      valueDefault = () => zero;
      break;
    }
    case "message": {
      const { toMessage, toLocal } = localMessageMapper(field);
      const readChild = compiledReader(field.message).read;
      readValue = (reader2, ctx, existing) => {
        const child = toMessage(existing);
        readChild(child, reader2, ctx, reader2.uint32());
        return toLocal(child);
      };
      valueDefault = () => toLocal(toMessage(void 0));
      break;
    }
  }
  return (message, reader2, ctx) => {
    const record5 = message[localName];
    let key;
    let val;
    const len = reader2.uint32();
    const end = reader2.pos + len;
    while (reader2.pos < end) {
      const [fieldNo, wireType] = reader2.tag();
      switch (fieldNo) {
        case 1:
          key = readKey(reader2);
          break;
        case 2:
          val = readValue(reader2, ctx, val);
          break;
        default:
          reader2.skip(wireType, fieldNo, ctx.recursionLimit - ctx.depth);
      }
    }
    if (key === void 0) {
      key = keyZero;
    }
    if (val === void 0) {
      val = valueDefault();
    }
    setOwn(record5, key, val);
  };
}
function compileScalarReader(type, utf8Validation, longAsString) {
  switch (type) {
    case ScalarType.STRING:
      return (reader2) => reader2.string(utf8Validation);
    case ScalarType.BOOL:
      return (reader2) => reader2.bool();
    case ScalarType.DOUBLE:
      return (reader2) => reader2.double();
    case ScalarType.FLOAT:
      return (reader2) => reader2.float();
    case ScalarType.INT32:
      return (reader2) => reader2.int32();
    case ScalarType.INT64:
      if (longAsString) {
        return (reader2) => String(reader2.int64());
      }
      return (reader2) => reader2.int64();
    case ScalarType.UINT64:
      if (longAsString) {
        return (reader2) => String(reader2.uint64());
      }
      return (reader2) => reader2.uint64();
    case ScalarType.FIXED64:
      if (longAsString) {
        return (reader2) => String(reader2.fixed64());
      }
      return (reader2) => reader2.fixed64();
    case ScalarType.BYTES:
      return (reader2) => reader2.bytes();
    case ScalarType.FIXED32:
      return (reader2) => reader2.fixed32();
    case ScalarType.SFIXED32:
      return (reader2) => reader2.sfixed32();
    case ScalarType.SFIXED64:
      if (longAsString) {
        return (reader2) => String(reader2.sfixed64());
      }
      return (reader2) => reader2.sfixed64();
    case ScalarType.SINT64:
      if (longAsString) {
        return (reader2) => String(reader2.sint64());
      }
      return (reader2) => reader2.sint64();
    case ScalarType.UINT32:
      return (reader2) => reader2.uint32();
    case ScalarType.SINT32:
      return (reader2) => reader2.sint32();
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/file.js
function fileDesc(b64, imports) {
  var _a;
  const root = fromBinary(FileDescriptorProtoSchema, base64Decode(b64));
  root.messageType.forEach(restoreJsonNames);
  root.dependency = (_a = imports === null || imports === void 0 ? void 0 : imports.map((f) => f.proto.name)) !== null && _a !== void 0 ? _a : [];
  const reg = createEmbeddedFileRegistry(root, (protoFileName) => imports === null || imports === void 0 ? void 0 : imports.find((f) => f.proto.name === protoFileName));
  return reg.getFile(root.name);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/google/protobuf/any_pb.js
var file_google_protobuf_any = /* @__PURE__ */ fileDesc("Chlnb29nbGUvcHJvdG9idWYvYW55LnByb3RvEg9nb29nbGUucHJvdG9idWYiJgoDQW55EhAKCHR5cGVfdXJsGAEgASgJEg0KBXZhbHVlGAIgASgMQnYKE2NvbS5nb29nbGUucHJvdG9idWZCCEFueVByb3RvUAFaLGdvb2dsZS5nb2xhbmcub3JnL3Byb3RvYnVmL3R5cGVzL2tub3duL2FueXBiogIDR1BCqgIeR29vZ2xlLlByb3RvYnVmLldlbGxLbm93blR5cGVzYgZwcm90bzM");
var AnySchema = /* @__PURE__ */ messageDesc(file_google_protobuf_any, 0);

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/to-binary.js
var IMPLICIT4 = 2;
var LEGACY_REQUIRED2 = 3;
var writeDefaults = {
  writeUnknownFields: true
};
function makeWriteOptions(options) {
  return options ? Object.assign(Object.assign({}, writeDefaults), options) : writeDefaults;
}
function toBinary(schema2, message, options) {
  const writer2 = new BinaryWriter();
  compiledWriter(schema2)(writer2, makeWriteOptions(options), message);
  return writer2.finish();
}
var compiledWriters = /* @__PURE__ */ new WeakMap();
function compiledWriter(desc) {
  let compiled = compiledWriters.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage2(desc);
  }
  return compiled;
}
function compileMessage2(desc) {
  const typeName = desc.typeName;
  const sortedFields = desc.fields.concat().sort((a, b) => a.number - b.number);
  const foreignField = sortedFields[0];
  const fieldWriters = [];
  const compiled = (writer2, opts, message) => {
    if (message.$typeName !== typeName && foreignField !== void 0) {
      throw new FieldError(foreignField, `cannot use ${foreignField} with message ${message.$typeName}`, "ForeignFieldError");
    }
    for (let i = 0; i < fieldWriters.length; i++) {
      fieldWriters[i](writer2, opts, message);
    }
    const unknown = message.$unknown;
    if (unknown !== void 0 && opts.writeUnknownFields) {
      for (let i = 0; i < unknown.length; i++) {
        const { no, wireType, data } = unknown[i];
        writer2.tag(no, wireType).raw(data);
      }
    }
  };
  compiledWriters.set(desc, compiled);
  for (const field of sortedFields) {
    fieldWriters.push(compileField(field));
  }
  return compiled;
}
function compileField(field) {
  switch (field.fieldKind) {
    case "message":
    case "scalar":
    case "enum":
      return compileSingularField(field);
    case "list":
      return compileListField(field);
    case "map":
      return compileMapField(field);
  }
}
function compileSingularField(field) {
  const writeValue = compileSingularValue(field);
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (writer2, opts, message) => {
      const oneof = message[oneofLocalName];
      if (oneof.case === localName) {
        writeValue(writer2, opts, oneof.value);
      }
    };
  }
  if (field.presence != IMPLICIT4) {
    const requiredError = field.presence == LEGACY_REQUIRED2 ? `cannot encode ${field} to binary: required field not set` : void 0;
    return (writer2, opts, message) => {
      const value = message[localName];
      if (value !== void 0 && Object.prototype.hasOwnProperty.call(message, localName)) {
        writeValue(writer2, opts, value);
      } else if (requiredError !== void 0) {
        throw new Error(requiredError);
      }
    };
  }
  if (field.fieldKind == "enum") {
    const zero = field.enum.values[0].number;
    return (writer2, opts, message) => {
      const value = message[localName];
      if (value !== zero) {
        writeValue(writer2, opts, value);
      }
    };
  }
  switch (field.scalar) {
    case ScalarType.BOOL:
      return (writer2, opts, message) => {
        const value = message[localName];
        if (value !== false) {
          writeValue(writer2, opts, value);
        }
      };
    case ScalarType.STRING:
      return (writer2, opts, message) => {
        const value = message[localName];
        if (value !== "") {
          writeValue(writer2, opts, value);
        }
      };
    case ScalarType.BYTES:
      return (writer2, opts, message) => {
        const value = message[localName];
        if (!(value instanceof Uint8Array) || value.byteLength > 0) {
          writeValue(writer2, opts, value);
        }
      };
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return (writer2, opts, message) => {
        const value = message[localName];
        if (!Object.is(value, 0)) {
          writeValue(writer2, opts, value);
        }
      };
    default:
      return (writer2, opts, message) => {
        const value = message[localName];
        if (value != 0) {
          writeValue(writer2, opts, value);
        }
      };
  }
}
function compileSingularValue(field) {
  switch (field.fieldKind) {
    case "message": {
      const { toMessage } = localMessageMapper(field);
      const writeChild = compileChildWriter(field);
      return (writer2, opts, value) => {
        writeChild(writer2, opts, toMessage(value));
      };
    }
    case "scalar":
    case "enum": {
      const scalarType = field.fieldKind == "enum" ? ScalarType.INT32 : field.scalar;
      const fieldNo = field.number;
      const wireType = writeTypeOfScalar(scalarType);
      const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
      return (writer2, opts, value) => {
        writer2.tag(fieldNo, wireType);
        writeScalar(writer2, value);
      };
    }
  }
}
function compileListField(field) {
  const localName = field.localName;
  const fieldNo = field.number;
  switch (field.listKind) {
    case "message": {
      const { toMessage } = localMessageMapper(field);
      const writeChild = compileChildWriter(field);
      return (writer2, opts, message) => {
        const items = message[localName];
        for (let i = 0; i < items.length; i++) {
          writeChild(writer2, opts, toMessage(items[i]));
        }
      };
    }
    case "scalar":
    case "enum": {
      const scalarType = field.listKind == "enum" ? ScalarType.INT32 : field.scalar;
      const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
      if (field.packed) {
        return (writer2, opts, message) => {
          const items = message[localName];
          if (items.length == 0) {
            return;
          }
          writer2.tag(fieldNo, WireType.LengthDelimited).fork();
          for (let i = 0; i < items.length; i++) {
            writeScalar(writer2, items[i]);
          }
          writer2.join();
        };
      }
      const wireType = writeTypeOfScalar(scalarType);
      return (writer2, opts, message) => {
        const items = message[localName];
        for (let i = 0; i < items.length; i++) {
          writer2.tag(fieldNo, wireType);
          writeScalar(writer2, items[i]);
        }
      };
    }
  }
}
function compileMapField(field) {
  const localName = field.localName;
  const fieldNo = field.number;
  const writeKey = compileMapKey(field);
  if (field.mapKind == "message") {
    const { toMessage } = localMessageMapper(field);
    const writeMessage = compiledWriter(field.message);
    return (writer2, opts, message) => {
      const record5 = message[localName];
      const keys = Object.keys(record5);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        writer2.tag(fieldNo, WireType.LengthDelimited).fork();
        writeKey(writer2, key);
        writer2.tag(2, WireType.LengthDelimited).fork();
        writeMessage(writer2, opts, toMessage(record5[key]));
        writer2.join();
        writer2.join();
      }
    };
  }
  const scalarType = field.mapKind == "enum" ? ScalarType.INT32 : field.scalar;
  const valueWireType = writeTypeOfScalar(scalarType);
  const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
  return (writer2, opts, message) => {
    const record5 = message[localName];
    const keys = Object.keys(record5);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      writer2.tag(fieldNo, WireType.LengthDelimited).fork();
      writeKey(writer2, key);
      writer2.tag(2, valueWireType);
      writeScalar(writer2, record5[key]);
      writer2.join();
    }
  };
}
function compileMapKey(field) {
  const wireType = writeTypeOfScalar(field.mapKey);
  const writeScalar = compileScalarValue(field.mapKey, field.parent.typeName, field.name);
  const convertKey = compileMapKeyConverter(field.mapKey);
  return (writer2, key) => {
    writer2.tag(1, wireType);
    writeScalar(writer2, convertKey(key));
  };
}
function compileMapKeyConverter(type) {
  switch (type) {
    case ScalarType.STRING:
      return (key) => key;
    case ScalarType.BOOL:
      return (key) => key === "true" ? true : key === "false" ? false : key;
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return (key) => {
        try {
          return protoInt64.uParse(key);
        } catch (_a) {
          return key;
        }
      };
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return (key) => {
        try {
          return protoInt64.parse(key);
        } catch (_a) {
          return key;
        }
      };
    default:
      return (key) => {
        const n = Number.parseInt(key);
        return Number.isFinite(n) ? n : key;
      };
  }
}
function compileScalarValue(type, messageName, fieldName) {
  const writeScalar = compileScalarWrite(type);
  return (writer2, value) => {
    try {
      writeScalar(writer2, value);
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(`cannot encode field ${messageName}.${fieldName} to binary: ${e.message}`);
      }
      throw e;
    }
  };
}
function compileScalarWrite(type) {
  switch (type) {
    case ScalarType.STRING:
      return (writer2, value) => writer2.string(value);
    case ScalarType.BOOL:
      return (writer2, value) => writer2.bool(value);
    case ScalarType.DOUBLE:
      return (writer2, value) => writer2.double(value);
    case ScalarType.FLOAT:
      return (writer2, value) => writer2.float(value);
    case ScalarType.INT32:
      return (writer2, value) => writer2.int32(value);
    case ScalarType.INT64:
      return (writer2, value) => writer2.int64(value);
    case ScalarType.UINT64:
      return (writer2, value) => writer2.uint64(value);
    case ScalarType.FIXED64:
      return (writer2, value) => writer2.fixed64(value);
    case ScalarType.BYTES:
      return (writer2, value) => writer2.bytes(value);
    case ScalarType.FIXED32:
      return (writer2, value) => writer2.fixed32(value);
    case ScalarType.SFIXED32:
      return (writer2, value) => writer2.sfixed32(value);
    case ScalarType.SFIXED64:
      return (writer2, value) => writer2.sfixed64(value);
    case ScalarType.SINT64:
      return (writer2, value) => writer2.sint64(value);
    case ScalarType.UINT32:
      return (writer2, value) => writer2.uint32(value);
    case ScalarType.SINT32:
      return (writer2, value) => writer2.sint32(value);
  }
}
function writeField(writer2, opts, msg, field) {
  compileField(field)(writer2, opts, msg[unsafeLocal]);
}
function compileChildWriter(field) {
  const fieldNo = field.number;
  const writeMessage = compiledWriter(field.message);
  if (field.delimitedEncoding) {
    return (writer2, opts, child) => {
      writer2.tag(fieldNo, WireType.StartGroup);
      writeMessage(writer2, opts, child);
      writer2.tag(fieldNo, WireType.EndGroup);
    };
  }
  return (writer2, opts, child) => {
    writer2.tag(fieldNo, WireType.LengthDelimited).fork();
    writeMessage(writer2, opts, child);
    writer2.join();
  };
}
function writeTypeOfScalar(type) {
  switch (type) {
    case ScalarType.BYTES:
    case ScalarType.STRING:
      return WireType.LengthDelimited;
    case ScalarType.DOUBLE:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
      return WireType.Bit64;
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
    case ScalarType.FLOAT:
      return WireType.Bit32;
    default:
      return WireType.Varint;
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/any.js
function anyPack(schema2, message, into) {
  let ret = false;
  if (!into) {
    into = create(AnySchema);
    ret = true;
  }
  into.value = toBinary(schema2, message);
  into.typeUrl = typeNameToUrl(message.$typeName);
  return ret ? into : void 0;
}
function anyIs(any, descOrTypeName) {
  if (any.typeUrl === "") {
    return false;
  }
  const want = typeof descOrTypeName == "string" ? descOrTypeName : descOrTypeName.typeName;
  const got = typeUrlToName(any.typeUrl);
  return want === got;
}
function anyUnpack(any, registryOrMessageDesc) {
  if (any.typeUrl === "") {
    return void 0;
  }
  const desc = registryOrMessageDesc.kind == "message" ? registryOrMessageDesc : registryOrMessageDesc.getMessage(typeUrlToName(any.typeUrl));
  if (!desc || !anyIs(any, desc)) {
    return void 0;
  }
  return fromBinary(desc, any.value);
}
function typeNameToUrl(name) {
  return `type.googleapis.com/${name}`;
}
function typeUrlToName(url) {
  const slash = url.lastIndexOf("/");
  const name = slash >= 0 ? url.substring(slash + 1) : url;
  if (!name.length) {
    throw new Error(`invalid type url: ${url}`);
  }
  return name;
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/google/protobuf/struct_pb.js
var file_google_protobuf_struct = /* @__PURE__ */ fileDesc("Chxnb29nbGUvcHJvdG9idWYvc3RydWN0LnByb3RvEg9nb29nbGUucHJvdG9idWYihAEKBlN0cnVjdBIzCgZmaWVsZHMYASADKAsyIy5nb29nbGUucHJvdG9idWYuU3RydWN0LkZpZWxkc0VudHJ5GkUKC0ZpZWxkc0VudHJ5EgsKA2tleRgBIAEoCRIlCgV2YWx1ZRgCIAEoCzIWLmdvb2dsZS5wcm90b2J1Zi5WYWx1ZToCOAEi6gEKBVZhbHVlEjAKCm51bGxfdmFsdWUYASABKA4yGi5nb29nbGUucHJvdG9idWYuTnVsbFZhbHVlSAASFgoMbnVtYmVyX3ZhbHVlGAIgASgBSAASFgoMc3RyaW5nX3ZhbHVlGAMgASgJSAASFAoKYm9vbF92YWx1ZRgEIAEoCEgAEi8KDHN0cnVjdF92YWx1ZRgFIAEoCzIXLmdvb2dsZS5wcm90b2J1Zi5TdHJ1Y3RIABIwCgpsaXN0X3ZhbHVlGAYgASgLMhouZ29vZ2xlLnByb3RvYnVmLkxpc3RWYWx1ZUgAQgYKBGtpbmQiMwoJTGlzdFZhbHVlEiYKBnZhbHVlcxgBIAMoCzIWLmdvb2dsZS5wcm90b2J1Zi5WYWx1ZSobCglOdWxsVmFsdWUSDgoKTlVMTF9WQUxVRRAAQn8KE2NvbS5nb29nbGUucHJvdG9idWZCC1N0cnVjdFByb3RvUAFaL2dvb2dsZS5nb2xhbmcub3JnL3Byb3RvYnVmL3R5cGVzL2tub3duL3N0cnVjdHBi+AEBogIDR1BCqgIeR29vZ2xlLlByb3RvYnVmLldlbGxLbm93blR5cGVzYgZwcm90bzM");
var StructSchema = /* @__PURE__ */ messageDesc(file_google_protobuf_struct, 0);
var ValueSchema = /* @__PURE__ */ messageDesc(file_google_protobuf_struct, 1);
var ListValueSchema = /* @__PURE__ */ messageDesc(file_google_protobuf_struct, 2);
var NullValue;
(function(NullValue2) {
  NullValue2[NullValue2["NULL_VALUE"] = 0] = "NULL_VALUE";
})(NullValue || (NullValue = {}));

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/extensions.js
function getExtension(message, extension, options) {
  assertExtendee(extension, message);
  const ufs = filterUnknownFields(message.$unknown, extension);
  const [container, field, get] = createExtensionContainer(extension);
  const ctx = makeReadContext(options);
  for (const uf of ufs) {
    readField(container, new BinaryReader(uf.data), field, uf.wireType, ctx);
  }
  return get();
}
function setExtension(message, extension, value) {
  var _a;
  assertExtendee(extension, message);
  const ufs = ((_a = message.$unknown) !== null && _a !== void 0 ? _a : []).filter((uf) => uf.no !== extension.number);
  const [container, field] = createExtensionContainer(extension, value);
  const writer2 = new BinaryWriter();
  writeField(writer2, { writeUnknownFields: true }, container, field);
  const reader2 = new BinaryReader(writer2.finish());
  while (reader2.pos < reader2.len) {
    const [no, wireType] = reader2.tag();
    const data = reader2.skip(wireType, no);
    ufs.push({ no, wireType, data });
  }
  message.$unknown = ufs;
}
function filterUnknownFields(unknownFields, extension) {
  if (unknownFields === void 0)
    return [];
  if (extension.fieldKind === "enum" || extension.fieldKind === "scalar") {
    for (let i = unknownFields.length - 1; i >= 0; --i) {
      if (unknownFields[i].no == extension.number) {
        return [unknownFields[i]];
      }
    }
    return [];
  }
  return unknownFields.filter((uf) => uf.no === extension.number);
}
function createExtensionContainer(extension, value) {
  const localName = extension.typeName;
  const field = Object.assign(Object.assign({}, extension), { kind: "field", parent: extension.extendee, localName });
  const desc = Object.assign(Object.assign({}, extension.extendee), { fields: [field], members: [field], oneofs: [] });
  const container = create(desc, value !== void 0 ? { [localName]: value } : void 0);
  return [
    reflect(desc, container),
    field,
    () => {
      const value2 = container[localName];
      if (value2 === void 0) {
        const desc2 = extension.message;
        if (isWrapperDesc(desc2)) {
          return scalarZeroValue(desc2.fields[0].scalar, desc2.fields[0].longAsString);
        }
        return create(desc2);
      }
      return value2;
    }
  ];
}
function assertExtendee(extension, message) {
  if (extension.extendee.typeName != message.$typeName) {
    throw new Error(`extension ${extension.typeName} can only be applied to message ${extension.extendee.typeName}`);
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/wkt/json.js
var timestampMsMin = /* @__PURE__ */ Date.parse("0001-01-01T00:00:00Z");
var timestampMsMax = /* @__PURE__ */ Date.parse("9999-12-31T23:59:59Z");
var durationSecondsMin = -315576e6;
var durationSecondsMax = 315576e6;

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/to-json.js
var LEGACY_REQUIRED3 = 3;
var IMPLICIT5 = 2;
var jsonWriteDefaults = {
  alwaysEmitImplicit: false,
  enumAsInteger: false,
  useProtoFieldName: false
};
function makeWriteOptions2(options) {
  return options ? Object.assign(Object.assign({}, jsonWriteDefaults), options) : jsonWriteDefaults;
}
function toJson(schema2, message, options) {
  return compiledWriter2(schema2)(makeWriteOptions2(options), message);
}
var compiledWriters2 = /* @__PURE__ */ new WeakMap();
function compiledWriter2(desc) {
  let compiled = compiledWriters2.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage3(desc);
  }
  return compiled;
}
function compileMessage3(desc) {
  const typeName = desc.typeName;
  const writeWkt = compileWkt(desc);
  if (writeWkt !== void 0) {
    const foreignField2 = desc.fields[0];
    const compiledWriter4 = (opts, message) => {
      if (message.$typeName !== typeName && foreignField2 !== void 0) {
        throw new FieldError(foreignField2, `cannot use ${foreignField2} with message ${message.$typeName}`, "ForeignFieldError");
      }
      return writeWkt(opts, message);
    };
    compiledWriters2.set(desc, compiledWriter4);
    return compiledWriter4;
  }
  const sortedFields = desc.fields.concat().sort((a, b) => a.number - b.number);
  const foreignField = sortedFields[0];
  const fieldWriters = [];
  const compiledWriter3 = (opts, message) => {
    if (message.$typeName !== typeName && foreignField !== void 0) {
      throw new FieldError(foreignField, `cannot use ${foreignField} with message ${message.$typeName}`, "ForeignFieldError");
    }
    const json = {};
    for (let i = 0; i < fieldWriters.length; i++) {
      fieldWriters[i](opts, message, json);
    }
    if (opts.registry) {
      writeExtensions(json, opts, opts.registry, message, desc);
    }
    return json;
  };
  compiledWriters2.set(desc, compiledWriter3);
  for (const field of sortedFields) {
    const writeField2 = compileField2(field);
    fieldWriters.push(field.jsonName === "__proto__" || field.name === "__proto__" ? writeOwnKeys(writeField2) : writeField2);
  }
  return compiledWriter3;
}
function writeOwnKeys(writeField2) {
  return (opts, message, json) => {
    const tmp = /* @__PURE__ */ Object.create(null);
    writeField2(opts, message, tmp);
    for (const key of Object.keys(tmp)) {
      setOwn(json, key, tmp[key]);
    }
  };
}
function compileWkt(desc) {
  if (!desc.typeName.startsWith("google.protobuf.")) {
    return void 0;
  }
  switch (desc.typeName) {
    case "google.protobuf.Any":
      return (opts, message) => anyToJson(message, opts);
    case "google.protobuf.Timestamp":
      return (opts, message) => timestampToJson(message);
    case "google.protobuf.Duration":
      return (opts, message) => durationToJson(message);
    case "google.protobuf.FieldMask":
      return (opts, message) => fieldMaskToJson(message);
    case "google.protobuf.Struct":
      return (opts, message) => structToJson(message);
    case "google.protobuf.Value":
      return (opts, message) => valueToJson(message);
    case "google.protobuf.ListValue":
      return (opts, message) => listValueToJson(message);
    default:
      if (isWrapperDesc(desc)) {
        const valueField = desc.fields[0];
        const localName = valueField.localName;
        const zero = scalarZeroValue(valueField.scalar, false);
        const writeScalar = compileScalarValue2(valueField);
        return (opts, message) => {
          const value = message[localName];
          return writeScalar(opts, value === void 0 ? zero : value);
        };
      }
      return void 0;
  }
}
function compileField2(field) {
  switch (field.fieldKind) {
    case "scalar":
    case "enum":
    case "message":
      return compileSingularField2(field);
    case "list":
    case "map": {
      const writeValue = field.fieldKind == "list" ? compileListValue(field) : compileMapValue(field);
      const protoName = field.name;
      const jsonKey = field.jsonName;
      const localName = field.localName;
      return (opts, message, json) => {
        const value = writeValue(opts, message[localName]);
        if (value !== void 0) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = value;
        }
      };
    }
  }
}
function compileSingularField2(field) {
  const writeValue = compileSingularValue2(field);
  const protoName = field.name;
  const jsonKey = field.jsonName;
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (opts, message, json) => {
      const oneof = message[oneofLocalName];
      if (oneof.case === localName) {
        json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, oneof.value);
      }
    };
  }
  if (field.presence != IMPLICIT5) {
    const requiredError = field.presence == LEGACY_REQUIRED3 ? `cannot encode ${field} to JSON: required field not set` : void 0;
    return (opts, message, json) => {
      const value = message[localName];
      if (value !== void 0 && Object.prototype.hasOwnProperty.call(message, localName)) {
        json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
      } else if (requiredError !== void 0) {
        throw new Error(requiredError);
      }
    };
  }
  if (field.fieldKind == "enum") {
    const zero = field.enum.values[0].number;
    return (opts, message, json) => {
      const value = message[localName];
      if (value !== zero || opts.alwaysEmitImplicit) {
        json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
      }
    };
  }
  switch (field.scalar) {
    case ScalarType.BOOL:
      return (opts, message, json) => {
        const value = message[localName];
        if (value !== false || opts.alwaysEmitImplicit) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
        }
      };
    case ScalarType.STRING:
      return (opts, message, json) => {
        const value = message[localName];
        if (value !== "" || opts.alwaysEmitImplicit) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
        }
      };
    case ScalarType.BYTES:
      return (opts, message, json) => {
        const value = message[localName];
        if (!(value instanceof Uint8Array) || value.byteLength > 0 || opts.alwaysEmitImplicit) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
        }
      };
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return (opts, message, json) => {
        const value = message[localName];
        if (!Object.is(value, 0) || opts.alwaysEmitImplicit) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
        }
      };
    default:
      return (opts, message, json) => {
        const value = message[localName];
        if (value != 0 || opts.alwaysEmitImplicit) {
          json[opts.useProtoFieldName ? protoName : jsonKey] = writeValue(opts, value);
        }
      };
  }
}
function compileFieldValue(field) {
  switch (field.fieldKind) {
    case "scalar":
    case "enum":
    case "message":
      return compileSingularValue2(field);
    case "list":
      return compileListValue(field);
    case "map":
      return compileMapValue(field);
  }
}
function compileSingularValue2(field) {
  switch (field.fieldKind) {
    case "scalar":
      return compileScalarValue2(field);
    case "enum":
      return compileEnumValue(field);
    case "message":
      return compileMessageValue(field);
  }
}
function compileMessageValue(field) {
  const { toMessage } = localMessageMapper(field);
  const writeMessage = compiledWriter2(field.message);
  return (opts, value) => writeMessage(opts, toMessage(value));
}
function compileListValue(field) {
  const writeItem = compileListItemValue(field);
  return (opts, value) => {
    const items = value;
    if (items.length == 0 && !opts.alwaysEmitImplicit) {
      return void 0;
    }
    const jsonArray = [];
    for (let i = 0; i < items.length; i++) {
      jsonArray.push(writeItem(opts, items[i]));
    }
    return jsonArray;
  };
}
function compileListItemValue(field) {
  switch (field.listKind) {
    case "scalar":
      return compileScalarValue2(field);
    case "enum":
      return compileEnumValue(field);
    case "message":
      return compileMessageValue(field);
  }
}
function compileMapValue(field) {
  const writeMapValue = compileMapEntryValue(field);
  return (opts, value) => {
    const record5 = value;
    const keys = Object.keys(record5);
    if (keys.length == 0 && !opts.alwaysEmitImplicit) {
      return void 0;
    }
    const jsonObject = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      setOwn(jsonObject, key, writeMapValue(opts, record5[key]));
    }
    return jsonObject;
  };
}
function compileMapEntryValue(field) {
  switch (field.mapKind) {
    case "scalar":
      return compileScalarValue2(field);
    case "enum":
      return compileEnumValue(field);
    case "message":
      return compileMessageValue(field);
  }
}
function compileEnumValue(field) {
  const desc = field.enum;
  if (desc.typeName == "google.protobuf.NullValue") {
    return (opts, value) => {
      if (typeof value != "number") {
        throw errorEnumValue(desc, value);
      }
      return null;
    };
  }
  return (opts, value) => {
    var _a, _b;
    if (typeof value != "number") {
      throw errorEnumValue(desc, value);
    }
    if (opts.enumAsInteger) {
      return value;
    }
    return (_b = (_a = desc.value[value]) === null || _a === void 0 ? void 0 : _a.jsonName) !== null && _b !== void 0 ? _b : value;
  };
}
function errorEnumValue(desc, value) {
  return new Error(`cannot encode ${desc} to JSON: expected number, got ${formatVal(value)}`);
}
function compileScalarValue2(field) {
  switch (field.scalar) {
    // int32, fixed32, uint32: JSON value will be a decimal number. Either numbers or strings are accepted.
    case ScalarType.INT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
      return (opts, value) => {
        if (typeof value != "number") {
          throw errorScalarValue(field, value);
        }
        return value;
      };
    // float, double: JSON value will be a number or one of the special string values "NaN", "Infinity", and "-Infinity".
    // Either numbers or strings are accepted. Exponent notation is also accepted.
    case ScalarType.FLOAT:
    case ScalarType.DOUBLE:
      return (opts, value) => {
        if (typeof value != "number") {
          throw errorScalarValue(field, value);
        }
        if (Number.isNaN(value))
          return "NaN";
        if (value === Number.POSITIVE_INFINITY)
          return "Infinity";
        if (value === Number.NEGATIVE_INFINITY)
          return "-Infinity";
        return value;
      };
    // string:
    case ScalarType.STRING:
      return (opts, value) => {
        if (typeof value != "string") {
          throw errorScalarValue(field, value);
        }
        return value;
      };
    // bool:
    case ScalarType.BOOL:
      return (opts, value) => {
        if (typeof value != "boolean") {
          throw errorScalarValue(field, value);
        }
        return value;
      };
    // JSON value will be a decimal string. Either numbers or strings are accepted.
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return (opts, value) => {
        if (typeof value == "bigint" || typeof value == "string" || typeof value == "number" && Number.isInteger(value)) {
          return value.toString();
        }
        throw errorScalarValue(field, value);
      };
    // bytes: JSON value will be the data encoded as a string using standard base64 encoding with paddings.
    // Either standard or URL-safe base64 encoding with/without paddings are accepted.
    case ScalarType.BYTES:
      return (opts, value) => {
        if (value instanceof Uint8Array) {
          return base64Encode(value);
        }
        throw errorScalarValue(field, value);
      };
  }
}
function errorScalarValue(field, value) {
  var _a;
  return new Error(`cannot encode ${field} to JSON: ${(_a = checkField(field, value)) === null || _a === void 0 ? void 0 : _a.message}`);
}
function writeExtensions(json, opts, registry, message, desc) {
  const unknown = message.$unknown;
  if (unknown === void 0) {
    return;
  }
  const tagSeen = /* @__PURE__ */ new Set();
  for (let i = 0; i < unknown.length; i++) {
    const { no } = unknown[i];
    if (!tagSeen.has(no)) {
      tagSeen.add(no);
      const extension = registry.getExtensionFor(desc, no);
      if (!extension) {
        continue;
      }
      const value = getExtension(message, extension);
      const [container, field] = createExtensionContainer(extension, value);
      const local = container[unsafeLocal];
      const jsonValue = compileFieldValue(field)(opts, local[field.localName]);
      if (jsonValue !== void 0) {
        json[extension.jsonName] = jsonValue;
      }
    }
  }
}
function anyToJson(val, opts) {
  if (val.typeUrl === "") {
    return {};
  }
  const { registry } = opts;
  let message;
  let desc;
  if (registry) {
    message = anyUnpack(val, registry);
    if (message) {
      desc = registry.getMessage(message.$typeName);
    }
  }
  if (!desc || !message) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: "${val.typeUrl}" is not in the type registry`);
  }
  const json = hasCustomJsonRepresentation(desc) ? {
    value: compiledWriter2(desc)(opts, message)
  } : compiledWriter2(desc)(opts, message);
  json["@type"] = val.typeUrl;
  return json;
}
function durationToJson(val) {
  const seconds = Number(val.seconds);
  const nanos = val.nanos;
  if (seconds > durationSecondsMax || seconds < durationSecondsMin) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: value out of range`);
  }
  if (seconds > 0 && nanos < 0 || seconds < 0 && nanos > 0) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: nanos sign must match seconds sign`);
  }
  let text2 = val.seconds.toString();
  if (nanos !== 0) {
    let nanosStr = Math.abs(nanos).toString();
    nanosStr = "0".repeat(9 - nanosStr.length) + nanosStr;
    if (nanosStr.substring(3) === "000000") {
      nanosStr = nanosStr.substring(0, 3);
    } else if (nanosStr.substring(6) === "000") {
      nanosStr = nanosStr.substring(0, 6);
    }
    text2 += "." + nanosStr;
    if (nanos < 0 && seconds == 0) {
      text2 = "-" + text2;
    }
  }
  return text2 + "s";
}
function fieldMaskToJson(val) {
  return val.paths.map((p) => {
    if (protoSnakeCase(protoCamelCase(p)) !== p) {
      throw new Error(`cannot encode message ${val.$typeName} to JSON: lowerCamelCase of path name "${p}" is irreversible`);
    }
    return protoCamelCase(p);
  }).join(",");
}
function structToJson(val) {
  const json = {};
  const keys = Object.keys(val.fields);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    setOwn(json, key, valueToJson(val.fields[key]));
  }
  return json;
}
function valueToJson(val) {
  switch (val.kind.case) {
    case "nullValue":
      return null;
    case "numberValue":
      if (!Number.isFinite(val.kind.value)) {
        throw new Error(`${val.$typeName} cannot be NaN or Infinity`);
      }
      return val.kind.value;
    case "boolValue":
      return val.kind.value;
    case "stringValue":
      return val.kind.value;
    case "structValue":
      return structToJson(val.kind.value);
    case "listValue":
      return listValueToJson(val.kind.value);
    default:
      throw new Error(`${val.$typeName} must have a value`);
  }
}
function listValueToJson(val) {
  return val.values.map(valueToJson);
}
function timestampToJson(val) {
  const ms = Number(val.seconds) * 1e3;
  if (ms < timestampMsMin || ms > timestampMsMax) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive`);
  }
  if (val.nanos < 0) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: nanos must not be negative`);
  }
  if (val.nanos > 999999999) {
    throw new Error(`cannot encode message ${val.$typeName} to JSON: nanos must not be greater than 999999999`);
  }
  let z = "Z";
  if (val.nanos > 0) {
    const nanosStr = (val.nanos + 1e9).toString().substring(1);
    if (nanosStr.substring(3) === "000000") {
      z = "." + nanosStr.substring(0, 3) + "Z";
    } else if (nanosStr.substring(6) === "000") {
      z = "." + nanosStr.substring(0, 6) + "Z";
    } else {
      z = "." + nanosStr + "Z";
    }
  }
  return new Date(ms).toISOString().replace(".000Z", z);
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/from-json.js
var IMPLICIT6 = 2;
function makeReadContext2(options) {
  return Object.assign(Object.assign({ ignoreUnknownFields: false, recursionLimit: 100 }, options), { depth: 0 });
}
function fromJson(schema2, json, options) {
  const message = create(schema2);
  readMessage(schema2, message, json, options);
  return message;
}
function readMessage(schema2, message, json, options) {
  try {
    compiledReader2(schema2)(message, json, makeReadContext2(options));
  } catch (e) {
    if (isFieldError(e)) {
      throw new Error(`cannot decode ${e.field()} from JSON: ${e.message}`, {
        cause: e
      });
    }
    throw e;
  }
}
var compiledReaders2 = /* @__PURE__ */ new WeakMap();
function compiledReader2(desc) {
  let compiled = compiledReaders2.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage4(desc);
  }
  return compiled;
}
function compileMessage4(desc) {
  const descString = String(desc);
  const readWkt = compileWkt2(desc);
  if (readWkt !== void 0) {
    const compiled2 = (message, json, ctx) => {
      if (++ctx.depth > ctx.recursionLimit) {
        throw new Error(`cannot decode ${descString} from JSON: maximum recursion depth of ${ctx.recursionLimit} reached`);
      }
      readWkt(message, json, ctx);
      ctx.depth--;
    };
    compiledReaders2.set(desc, compiled2);
    return compiled2;
  }
  const typeName = desc.typeName;
  const fieldsByJsonKey = /* @__PURE__ */ new Map();
  const compiled = (message, json, ctx) => {
    var _a;
    if (++ctx.depth > ctx.recursionLimit) {
      throw new Error(`cannot decode ${descString} from JSON: maximum recursion depth of ${ctx.recursionLimit} reached`);
    }
    if (json == null || Array.isArray(json) || typeof json != "object") {
      throw new Error(`cannot decode ${descString} from JSON: ${formatVal(json)}`);
    }
    const oneofSeen = /* @__PURE__ */ new Map();
    const fieldSeen = /* @__PURE__ */ new Set();
    const jsonKeys = Object.keys(json);
    for (let i = 0; i < jsonKeys.length; i++) {
      const jsonKey = jsonKeys[i];
      const jsonValue = json[jsonKey];
      const entry = fieldsByJsonKey.get(jsonKey);
      if (entry !== void 0) {
        const field = entry.field;
        if (fieldSeen.has(field)) {
          throw new FieldError(field, "set multiple times");
        }
        fieldSeen.add(field);
        if (entry.oneofScalarNullSkip && jsonValue === null) {
          continue;
        }
        if (entry.oneof) {
          const seen = oneofSeen.get(entry.oneof);
          if (seen !== void 0) {
            throw new FieldError(entry.oneof, `oneof set multiple times by ${seen.name} and ${field.name}`);
          }
          oneofSeen.set(entry.oneof, field);
        }
        entry.read(message, jsonValue, ctx);
      } else {
        const extension = jsonKey.startsWith("[") && jsonKey.endsWith("]") ? (_a = ctx.registry) === null || _a === void 0 ? void 0 : _a.getExtension(jsonKey.substring(1, jsonKey.length - 1)) : void 0;
        if ((extension === null || extension === void 0 ? void 0 : extension.extendee.typeName) == typeName) {
          const [container, field, get] = createExtensionContainer(extension);
          compileFieldReader2(field)(container[unsafeLocal], jsonValue, ctx);
          setExtension(message, extension, get());
        }
        if (extension === void 0 && !ctx.ignoreUnknownFields) {
          throw new Error(`cannot decode ${descString} from JSON: key "${jsonKey}" is unknown`);
        }
      }
    }
    ctx.depth--;
  };
  compiledReaders2.set(desc, compiled);
  for (const field of desc.fields) {
    const entry = {
      read: compileFieldReader2(field),
      field,
      oneof: field.oneof,
      oneofScalarNullSkip: field.oneof !== void 0 && field.fieldKind == "scalar"
    };
    fieldsByJsonKey.set(field.name, entry).set(field.jsonName, entry);
  }
  return compiled;
}
function compileWkt2(desc) {
  if (!desc.typeName.startsWith("google.protobuf.")) {
    return void 0;
  }
  switch (desc.typeName) {
    case "google.protobuf.Any":
      return (message, json, ctx) => anyFromJson(message, json, ctx);
    case "google.protobuf.Timestamp":
      return (message, json) => timestampFromJson(message, json);
    case "google.protobuf.Duration":
      return (message, json) => durationFromJson(message, json);
    case "google.protobuf.FieldMask":
      return (message, json) => fieldMaskFromJson(message, json);
    case "google.protobuf.Struct":
      return (message, json, ctx) => structFromJson(message, json, ctx);
    case "google.protobuf.Value":
      return (message, json, ctx) => valueFromJson(message, json, ctx);
    case "google.protobuf.ListValue":
      return (message, json, ctx) => listValueFromJson(message, json, ctx);
    default:
      if (isWrapperDesc(desc)) {
        const valueField = desc.fields[0];
        const localName = valueField.localName;
        const scalar = valueField.scalar;
        const longAsString = valueField.longAsString;
        const readScalar = compileScalarConverter(valueField);
        return (message, json) => {
          if (json === null) {
            message[localName] = scalarZeroValue(scalar, longAsString);
          } else {
            message[localName] = readScalar(json);
          }
        };
      }
      return void 0;
  }
}
function compileFieldReader2(field) {
  switch (field.fieldKind) {
    case "scalar":
      return compileScalarFieldReader2(field);
    case "enum":
      return compileEnumFieldReader2(field);
    case "message":
      return compileMessageFieldReader2(field);
    case "list":
      return compileListFieldReader2(field);
    case "map":
      return compileMapFieldReader2(field);
  }
}
function compileScalarFieldReader2(field) {
  const readScalar = compileScalarConverter(field);
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, json) => {
      message[oneofLocalName] = {
        case: localName,
        value: readScalar(json)
      };
    };
  }
  const clear = compileClear(field);
  return (message, json) => {
    if (json === null) {
      clear(message);
    } else {
      message[localName] = readScalar(json);
    }
  };
}
function compileClear(field) {
  const localName = field.localName;
  if (field.presence != IMPLICIT6) {
    return (message) => {
      delete message[localName];
    };
  }
  if (field.fieldKind == "enum") {
    const zero = field.enum.values[0].number;
    return (message) => {
      message[localName] = zero;
    };
  }
  const scalar = field.scalar;
  const longAsString = field.longAsString;
  return (message) => {
    message[localName] = scalarZeroValue(scalar, longAsString);
  };
}
function compileEnumFieldReader2(field) {
  const readEnumValue = compileEnumConverter(field.enum);
  const checkEnum = compileEnumCheck(field.enum);
  const localName = field.localName;
  const nullResets = field.enum.typeName != "google.protobuf.NullValue";
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, json, ctx) => {
      if (json === null && nullResets) {
        const oneof = message[oneofLocalName];
        if (oneof.case === localName) {
          message[oneofLocalName] = { case: void 0 };
        }
        return;
      }
      const value = readEnumValue(json, ctx.ignoreUnknownFields);
      if (value === tokenIgnoredUnknownEnum) {
        return;
      }
      const check = checkEnum(value);
      if (check !== true) {
        throw new FieldError(field, reasonSingular(field, value, check));
      }
      message[oneofLocalName] = { case: localName, value };
    };
  }
  const clear = compileClear(field);
  return (message, json, ctx) => {
    if (json === null && nullResets) {
      clear(message);
      return;
    }
    const value = readEnumValue(json, ctx.ignoreUnknownFields);
    if (value === tokenIgnoredUnknownEnum) {
      return;
    }
    const check = checkEnum(value);
    if (check !== true) {
      throw new FieldError(field, reasonSingular(field, value, check));
    }
    message[localName] = value;
  };
}
function compileMessageFieldReader2(field) {
  const localName = field.localName;
  const { toMessage, toLocal } = localMessageMapper(field);
  const readChild = compiledReader2(field.message);
  const nullResets = field.message.typeName != "google.protobuf.Value";
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, json, ctx) => {
      const oneof = message[oneofLocalName];
      if (json === null && nullResets) {
        if (oneof.case === localName) {
          message[oneofLocalName] = { case: void 0 };
        }
        return;
      }
      const child = toMessage(oneof.case === localName ? oneof.value : void 0);
      readChild(child, json, ctx);
      message[oneofLocalName] = { case: localName, value: toLocal(child) };
    };
  }
  return (message, json, ctx) => {
    if (json === null && nullResets) {
      delete message[localName];
      return;
    }
    const child = toMessage(message[localName]);
    readChild(child, json, ctx);
    message[localName] = toLocal(child);
  };
}
function compileListFieldReader2(field) {
  const localName = field.localName;
  const readItem = compileListItemReader(field);
  return (message, json, ctx) => {
    if (json === null) {
      return;
    }
    if (!Array.isArray(json)) {
      throw new FieldError(field, "expected Array, got " + formatVal(json));
    }
    const items = message[localName];
    for (let i = 0; i < json.length; i++) {
      const value = readItem(json[i], ctx, items.length);
      if (value !== tokenIgnoredUnknownEnum) {
        items.push(value);
      }
    }
  };
}
function compileListItemReader(field) {
  switch (field.listKind) {
    case "scalar": {
      const parseScalar = compileScalarParse(field);
      const checkValue = checkScalarValue(field.scalar);
      const toLocal = compileScalarToLocal(field);
      return (json, ctx, index) => {
        if (json === null) {
          throw new FieldError(field, "list item must not be null");
        }
        const value = parseScalar(json);
        const check = checkValue(value);
        if (check !== true) {
          throw new FieldError(field, `list item #${index + 1}: ${reasonSingular(field, value, check)}`);
        }
        return toLocal(value);
      };
    }
    case "enum": {
      const readEnumValue = compileEnumConverter(field.enum);
      const checkEnum = compileEnumCheck(field.enum);
      const nullResets = field.enum.typeName != "google.protobuf.NullValue";
      return (json, ctx, index) => {
        if (json === null && nullResets) {
          throw new FieldError(field, "list item must not be null");
        }
        const value = readEnumValue(json, ctx.ignoreUnknownFields);
        if (value === tokenIgnoredUnknownEnum) {
          return value;
        }
        const check = checkEnum(value);
        if (check !== true) {
          throw new FieldError(field, `list item #${index + 1}: ${reasonSingular(field, value, check)}`);
        }
        return value;
      };
    }
    case "message": {
      const { toMessage, toLocal } = localMessageMapper(field);
      const readChild = compiledReader2(field.message);
      const nullResets = field.message.typeName != "google.protobuf.Value";
      return (json, ctx) => {
        if (json === null && nullResets) {
          throw new FieldError(field, "list item must not be null");
        }
        const child = toMessage(void 0);
        readChild(child, json, ctx);
        return toLocal(child);
      };
    }
  }
}
function compileMapFieldReader2(field) {
  const localName = field.localName;
  const mapKey = field.mapKey;
  const parseMapKey = compileMapKeyParse(mapKey);
  const checkMapKey = checkScalarValue(mapKey);
  let parseValue;
  let checkValue;
  let toLocalValue = (value) => value;
  let nullResets = true;
  switch (field.mapKind) {
    case "scalar": {
      parseValue = compileScalarParse(field);
      checkValue = checkScalarValue(field.scalar);
      toLocalValue = compileScalarToLocal(field);
      break;
    }
    case "enum": {
      const readEnumValue = compileEnumConverter(field.enum);
      parseValue = (json, ctx) => readEnumValue(json, ctx.ignoreUnknownFields);
      checkValue = compileEnumCheck(field.enum);
      nullResets = field.enum.typeName != "google.protobuf.NullValue";
      break;
    }
    case "message": {
      const { toMessage, toLocal } = localMessageMapper(field);
      const readChild = compiledReader2(field.message);
      nullResets = field.message.typeName != "google.protobuf.Value";
      parseValue = (json, ctx) => {
        const child = toMessage(void 0);
        readChild(child, json, ctx);
        return toLocal(child);
      };
      break;
    }
  }
  return (message, json, ctx) => {
    if (json === null) {
      return;
    }
    if (typeof json != "object" || Array.isArray(json)) {
      throw new FieldError(field, "expected object, got " + formatVal(json));
    }
    const record5 = message[localName];
    const seen = /* @__PURE__ */ new Set();
    const jsonMapKeys = Object.keys(json);
    for (let i = 0; i < jsonMapKeys.length; i++) {
      const jsonMapKey = jsonMapKeys[i];
      const jsonMapValue = json[jsonMapKey];
      const key = parseMapKey(jsonMapKey);
      if (seen.has(key)) {
        throw new FieldError(field, `duplicate map key "${jsonMapKey}"`);
      }
      seen.add(key);
      if (jsonMapValue === null && nullResets) {
        throw new FieldError(field, "map value must not be null");
      }
      const value = parseValue(jsonMapValue, ctx);
      if (value === tokenIgnoredUnknownEnum) {
        continue;
      }
      const checkKey = checkMapKey(key);
      if (checkKey !== true) {
        throw new FieldError(field, `invalid map key: ${reasonSingular({ scalar: mapKey }, key, checkKey)}`);
      }
      if (checkValue !== void 0) {
        const check = checkValue(value);
        if (check !== true) {
          throw new FieldError(field, `map entry ${formatVal(key)}: ${reasonSingular(field, value, check)}`);
        }
      }
      setOwn(record5, key, toLocalValue(value));
    }
  };
}
var tokenIgnoredUnknownEnum = /* @__PURE__ */ Symbol();
function compileEnumConverter(desc) {
  const zero = desc.values[0].number;
  const numbers = /* @__PURE__ */ new Map();
  for (const value of desc.values) {
    numbers.set(value.jsonName, value.number);
  }
  for (const value of desc.values) {
    numbers.set(value.name, value.number);
  }
  return (json, ignoreUnknownFields) => {
    if (json === null) {
      return zero;
    }
    switch (typeof json) {
      case "number":
        if (Number.isInteger(json)) {
          return json;
        }
        break;
      case "string": {
        const number = numbers.get(json);
        if (number !== void 0) {
          return number;
        }
        if (ignoreUnknownFields) {
          return tokenIgnoredUnknownEnum;
        }
        break;
      }
    }
    throw new Error(`cannot decode ${desc} from JSON: ${formatVal(json)}`);
  };
}
function compileEnumCheck(desc) {
  if (desc.open) {
    return checkScalarValue(ScalarType.INT32);
  }
  const values = desc.values;
  return (value) => values.some((v) => v.number === value);
}
function compileScalarConverter(field) {
  const parseScalar = compileScalarParse(field);
  const checkValue = checkScalarValue(field.scalar);
  const toLocal = compileScalarToLocal(field);
  return (json) => {
    const value = parseScalar(json);
    const check = checkValue(value);
    if (check !== true) {
      throw new FieldError(field, reasonSingular(field, value, check));
    }
    return toLocal(value);
  };
}
function compileScalarParse(field) {
  switch (field.scalar) {
    // float, double: JSON value will be a number or one of the special string values "NaN", "Infinity", and "-Infinity".
    // Either numbers or strings are accepted. Exponent notation is also accepted.
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return (json) => {
        if (json === "NaN")
          return NaN;
        if (json === "Infinity")
          return Number.POSITIVE_INFINITY;
        if (json === "-Infinity")
          return Number.NEGATIVE_INFINITY;
        if (typeof json == "number") {
          if (Number.isNaN(json)) {
            throw new FieldError(field, "unexpected NaN number");
          }
          if (!Number.isFinite(json)) {
            throw new FieldError(field, "unexpected infinite number");
          }
          return json;
        }
        if (typeof json == "string") {
          if (json === "") {
            return json;
          }
          if (json.trim().length !== json.length) {
            return json;
          }
          const float = Number(json);
          if (!Number.isFinite(float)) {
            return json;
          }
          return float;
        }
        return json;
      };
    // int32, fixed32, uint32: JSON value will be a decimal number. Either numbers or strings are accepted.
    case ScalarType.INT32:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
    case ScalarType.UINT32:
      return int32FromJson;
    // bytes: JSON value will be the data encoded as a string using standard base64 encoding with paddings.
    // Either standard or URL-safe base64 encoding with/without paddings are accepted.
    case ScalarType.BYTES:
      return (json) => {
        if (typeof json == "string") {
          if (json === "") {
            return new Uint8Array(0);
          }
          try {
            return base64Decode(json);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            throw new FieldError(field, message);
          }
        }
        return json;
      };
    // int64, sfixed64, sint64, fixed64, uint64: The validation step accepts
    // string and number. string, bool: no conversion.
    default:
      return (json) => json;
  }
}
function compileScalarToLocal(field) {
  const longAsString = field.fieldKind !== "map" && field.longAsString;
  switch (field.scalar) {
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      if (longAsString) {
        return (value) => String(value);
      }
      return (value) => typeof value == "string" || typeof value == "number" ? protoInt64.parse(value) : value;
    case ScalarType.FIXED64:
    case ScalarType.UINT64:
      if (longAsString) {
        return (value) => String(value);
      }
      return (value) => typeof value == "string" || typeof value == "number" ? protoInt64.uParse(value) : value;
    default:
      return (value) => value;
  }
}
function compileMapKeyParse(type) {
  switch (type) {
    case ScalarType.BOOL:
      return (jsonString) => {
        switch (jsonString) {
          case "true":
            return true;
          case "false":
            return false;
        }
        return jsonString;
      };
    case ScalarType.INT32:
    case ScalarType.FIXED32:
    case ScalarType.UINT32:
    case ScalarType.SFIXED32:
    case ScalarType.SINT32:
      return int32FromJson;
    case ScalarType.INT64:
    case ScalarType.SINT64:
    case ScalarType.SFIXED64:
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return (jsonString) => /^-?0+$/.test(jsonString) ? "0" : jsonString.replace(/^(-?)0+(?=\d)/, "$1");
    default:
      return (jsonString) => jsonString;
  }
}
function int32FromJson(json) {
  if (typeof json == "string") {
    if (json === "") {
      return json;
    }
    if (json.trim().length !== json.length) {
      return json;
    }
    const num = Number(json);
    if (Number.isNaN(num)) {
      return json;
    }
    return num;
  }
  return json;
}
function anyFromJson(any, json, ctx) {
  var _a;
  if (json === null || Array.isArray(json) || typeof json != "object") {
    throw new Error(`cannot decode message ${any.$typeName} from JSON: expected object but got ${formatVal(json)}`);
  }
  if (Object.keys(json).length == 0) {
    return;
  }
  const typeUrl = json["@type"];
  if (typeof typeUrl != "string" || typeUrl == "") {
    throw new Error(`cannot decode message ${any.$typeName} from JSON: "@type" is empty`);
  }
  const typeName = typeUrl.includes("/") ? typeUrl.substring(typeUrl.lastIndexOf("/") + 1) : typeUrl;
  if (!typeName.length) {
    throw new Error(`cannot decode message ${any.$typeName} from JSON: "@type" is invalid`);
  }
  const desc = (_a = ctx.registry) === null || _a === void 0 ? void 0 : _a.getMessage(typeName);
  if (!desc) {
    throw new Error(`cannot decode message ${any.$typeName} from JSON: ${typeUrl} is not in the type registry`);
  }
  const message = create(desc);
  if (hasCustomJsonRepresentation(desc) && Object.prototype.hasOwnProperty.call(json, "value")) {
    compiledReader2(desc)(message, json.value, ctx);
  } else {
    const copy = {};
    for (const key of Object.keys(json)) {
      if (key !== "@type") {
        setOwn(copy, key, json[key]);
      }
    }
    compiledReader2(desc)(message, copy, ctx);
  }
  anyPack(desc, message, any);
}
function timestampFromJson(timestamp2, json) {
  if (typeof json !== "string") {
    throw new Error(`cannot decode message ${timestamp2.$typeName} from JSON: ${formatVal(json)}`);
  }
  const matches = json.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(?:Z|([+-][0-9][0-9]:[0-9][0-9]))$/);
  if (!matches) {
    throw new Error(`cannot decode message ${timestamp2.$typeName} from JSON: invalid RFC 3339 string`);
  }
  const ms = Date.parse(
    // biome-ignore format: want this to read well
    matches[1] + "-" + matches[2] + "-" + matches[3] + "T" + matches[4] + ":" + matches[5] + ":" + matches[6] + (matches[8] ? matches[8] : "Z")
  );
  if (Number.isNaN(ms)) {
    throw new Error(`cannot decode message ${timestamp2.$typeName} from JSON: invalid RFC 3339 string`);
  }
  if (ms < timestampMsMin || ms > timestampMsMax) {
    throw new Error(`cannot decode message ${timestamp2.$typeName} from JSON: must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive`);
  }
  timestamp2.seconds = protoInt64.parse(ms / 1e3);
  timestamp2.nanos = 0;
  if (matches[7]) {
    timestamp2.nanos = parseInt("1" + matches[7] + "0".repeat(9 - matches[7].length)) - 1e9;
  }
}
function durationFromJson(duration, json) {
  if (typeof json !== "string") {
    throw new Error(`cannot decode message ${duration.$typeName} from JSON: ${formatVal(json)}`);
  }
  const match = json.match(/^(-?[0-9]+)(?:\.([0-9]+))?s/);
  if (match === null) {
    throw new Error(`cannot decode message ${duration.$typeName} from JSON: ${formatVal(json)}`);
  }
  const longSeconds = Number(match[1]);
  if (longSeconds > durationSecondsMax || longSeconds < durationSecondsMin) {
    throw new Error(`cannot decode message ${duration.$typeName} from JSON: ${formatVal(json)}`);
  }
  duration.seconds = protoInt64.parse(longSeconds);
  if (typeof match[2] !== "string") {
    return;
  }
  const nanosStr = match[2] + "0".repeat(9 - match[2].length);
  duration.nanos = parseInt(nanosStr);
  if (longSeconds < 0 || Object.is(longSeconds, -0)) {
    duration.nanos = -duration.nanos;
  }
}
function fieldMaskFromJson(fieldMask, json) {
  if (typeof json !== "string") {
    throw new Error(`cannot decode message ${fieldMask.$typeName} from JSON: ${formatVal(json)}`);
  }
  if (json === "") {
    return;
  }
  fieldMask.paths = json.split(",").map((path2) => {
    if (path2.includes("_")) {
      throw new Error(`cannot decode message ${fieldMask.$typeName} from JSON: path names must be lowerCamelCase`);
    }
    return protoSnakeCase(path2);
  });
}
function structFromJson(struct, json, ctx) {
  if (typeof json != "object" || json == null || Array.isArray(json)) {
    throw new Error(`cannot decode message ${struct.$typeName} from JSON ${formatVal(json)}`);
  }
  const keys = Object.keys(json);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const parsedValue = create(ValueSchema);
    valueFromJson(parsedValue, json[key], ctx);
    setOwn(struct.fields, key, parsedValue);
  }
}
function valueFromJson(value, json, ctx) {
  if (++ctx.depth > ctx.recursionLimit) {
    throw new Error(`cannot decode ${value.$typeName} from JSON: maximum recursion depth of ${ctx.recursionLimit} reached`);
  }
  switch (typeof json) {
    case "number":
      value.kind = { case: "numberValue", value: json };
      break;
    case "string":
      value.kind = { case: "stringValue", value: json };
      break;
    case "boolean":
      value.kind = { case: "boolValue", value: json };
      break;
    case "object":
      if (json === null) {
        value.kind = { case: "nullValue", value: NullValue.NULL_VALUE };
      } else if (Array.isArray(json)) {
        const listValue = create(ListValueSchema);
        listValueFromJson(listValue, json, ctx);
        value.kind = { case: "listValue", value: listValue };
      } else {
        const struct = create(StructSchema);
        structFromJson(struct, json, ctx);
        value.kind = { case: "structValue", value: struct };
      }
      break;
    default:
      throw new Error(`cannot decode message ${value.$typeName} from JSON ${formatVal(json)}`);
  }
  ctx.depth--;
  return value;
}
function listValueFromJson(listValue, json, ctx) {
  if (!Array.isArray(json)) {
    throw new Error(`cannot decode message ${listValue.$typeName} from JSON ${formatVal(json)}`);
  }
  for (let i = 0; i < json.length; i++) {
    const value = create(ValueSchema);
    valueFromJson(value, json[i], ctx);
    listValue.values.push(value);
  }
}

// ../../../../node_modules/.pnpm/@bufbuild+protobuf@2.17.0/node_modules/@bufbuild/protobuf/dist/esm/codegenv2/service.js
function serviceDesc(file, path2, ...paths2) {
  if (paths2.length > 0) {
    throw new Error();
  }
  return file.services[path2];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/board_archive_service_pb.js
var file_luming_studio_v1_board_archive_service = /* @__PURE__ */ fileDesc("CixsdW1pbmcvc3R1ZGlvL3YxL2JvYXJkX2FyY2hpdmVfc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSJVChpJbXBvcnRCb2FyZEFyY2hpdmVSZXNwb25zZRI3CgdyZWNlaXB0GAEgASgLMiYubHVtaW5nLnN0dWRpby52MS5BcmNoaXZlSW1wb3J0UmVjZWlwdCKoAQoUQXJjaGl2ZUltcG9ydFJlY2VpcHQSEgoKY29tbWFuZF9pZBgBIAEoCRIzCghpbXBvcnRlZBgCIAEoCzIfLmx1bWluZy5zdHVkaW8udjEuSW1wb3J0ZWRCb2FyZEgAEjwKCHJlamVjdGVkGAMgASgLMigubHVtaW5nLnN0dWRpby52MS5BcmNoaXZlSW1wb3J0UmVqZWN0aW9uSABCCQoHb3V0Y29tZSIwCg1JbXBvcnRlZEJvYXJkEhAKCGJvYXJkX2lkGAEgASgJEg0KBXRpdGxlGAIgASgJImkKFkFyY2hpdmVJbXBvcnRSZWplY3Rpb24SPgoGcmVhc29uGAEgASgOMi4ubHVtaW5nLnN0dWRpby52MS5BcmNoaXZlSW1wb3J0UmVqZWN0aW9uUmVhc29uEg8KB21lc3NhZ2UYAiABKAkiNAoeR2V0QXJjaGl2ZUltcG9ydFJlY2VpcHRSZXF1ZXN0EhIKCmNvbW1hbmRfaWQYASABKAkiNQofQXJjaGl2ZUltcG9ydFJlY2VpcHROb3RSZWNvcmRlZBISCgpjb21tYW5kX2lkGAEgASgJIrEBCh9HZXRBcmNoaXZlSW1wb3J0UmVjZWlwdFJlc3BvbnNlEjkKB3JlY2VpcHQYASABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkFyY2hpdmVJbXBvcnRSZWNlaXB0SAASSQoMbm90X3JlY29yZGVkGAIgASgLMjEubHVtaW5nLnN0dWRpby52MS5BcmNoaXZlSW1wb3J0UmVjZWlwdE5vdFJlY29yZGVkSABCCAoGcmVzdWx0Kq0CChxBcmNoaXZlSW1wb3J0UmVqZWN0aW9uUmVhc29uEi8KK0FSQ0hJVkVfSU1QT1JUX1JFSkVDVElPTl9SRUFTT05fVU5TUEVDSUZJRUQQABIzCi9BUkNISVZFX0lNUE9SVF9SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfQVJDSElWRRABEjcKM0FSQ0hJVkVfSU1QT1JUX1JFSkVDVElPTl9SRUFTT05fVU5TVVBQT1JURURfVkVSU0lPThACEjgKNEFSQ0hJVkVfSU1QT1JUX1JFSkVDVElPTl9SRUFTT05fSU5DT01QQVRJQkxFX0NPTlRFTlQQAxI0CjBBUkNISVZFX0lNUE9SVF9SRUpFQ1RJT05fUkVBU09OX0NPTU1BTkRfSURfUkVVU0UQBDKVAQoTQm9hcmRBcmNoaXZlU2VydmljZRJ+ChdHZXRBcmNoaXZlSW1wb3J0UmVjZWlwdBIwLmx1bWluZy5zdHVkaW8udjEuR2V0QXJjaGl2ZUltcG9ydFJlY2VpcHRSZXF1ZXN0GjEubHVtaW5nLnN0dWRpby52MS5HZXRBcmNoaXZlSW1wb3J0UmVjZWlwdFJlc3BvbnNlYgZwcm90bzM");
var ImportBoardArchiveResponseSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_board_archive_service, 0);
var ArchiveImportRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_archive_service, 0);
var ArchiveImportRejectionReason = /* @__PURE__ */ tsEnum(ArchiveImportRejectionReasonSchema);
var BoardArchiveService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_board_archive_service, 0);

// src/entrypoints/http/request.ts
import { Buffer as Buffer2 } from "node:buffer";
var MAX_REQUEST_BYTES = 1024 * 1024;
var HttpRequestError = class extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.status = status;
  }
  status;
};
function mediaType(request) {
  return request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
}
function requireBodySize(bytes, limit) {
  if (bytes > limit) {
    throw new HttpRequestError(413, "Protobuf request exceeds the size limit");
  }
}
async function readBody(request, limit = MAX_REQUEST_BYTES) {
  requireBodySize(Number(request.headers["content-length"] ?? 0), limit);
  const chunks = [];
  let bytes = 0;
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    const chunk = value;
    if (!Buffer2.isBuffer(chunk)) {
      throw new TypeError("Expected binary HTTP request chunks");
    }
    bytes += chunk.byteLength;
    requireBodySize(bytes, limit);
    chunks.push(chunk);
  }
  return Buffer2.concat(chunks, bytes);
}
function decodeRequest(schema2, body) {
  try {
    return fromBinary(schema2, body, { readUnknownFields: false });
  } catch (error) {
    throw new HttpRequestError(400, "Malformed Protobuf request", { cause: error });
  }
}
function requireId(value) {
  if (!value.trim()) {
    throw new HttpRequestError(400, "Request identifier is required");
  }
  return value;
}

// src/entrypoints/http/response.ts
var protobufContentType = "application/protobuf";
function sendStatus(response, status) {
  if (status === 413) {
    response.setHeader("connection", "close");
  }
  response.writeHead(status, { "cache-control": "no-store", "content-length": 0 }).end();
}
function sendProtobuf(response, result) {
  response.writeHead(200, {
    "content-type": protobufContentType,
    "content-length": result.byteLength,
    "cache-control": "no-store"
  });
  response.end(result);
}

// src/entrypoints/http/unary-route.ts
function unaryRoute(method, handle) {
  const path2 = `/${method.parent.typeName}/${method.name}`;
  return [
    path2,
    (actor, body) => {
      const request = decodeRequest(method.input, body);
      actor.authorize?.(request);
      const response = handle(actor, request);
      return toBinary(method.output, create(method.output, response));
    }
  ];
}
function asyncUnaryRoute(method, handle) {
  const path2 = `/${method.parent.typeName}/${method.name}`;
  return [
    path2,
    async (actor, body) => {
      const request = decodeRequest(method.input, body);
      actor.authorize?.(request);
      const response = await handle(actor, request);
      return toBinary(method.output, create(method.output, response));
    }
  ];
}

// src/entrypoints/http/archive-routes.ts
var archiveImportPath = "/" + BoardArchiveService.typeName + "/ImportBoardArchive";
var archiveAssetPrefix = "/studio-archive-assets/";
var archiveContentType = "application/zip";
var commandHeader = "x-studio-command-id";
var rejectionCodes = {
  invalidArchive: ArchiveImportRejectionReason.INVALID_ARCHIVE,
  unsupportedVersion: ArchiveImportRejectionReason.UNSUPPORTED_VERSION,
  incompatibleContent: ArchiveImportRejectionReason.INCOMPATIBLE_CONTENT,
  commandIdReuse: ArchiveImportRejectionReason.COMMAND_ID_REUSE,
  tooLarge: ArchiveImportRejectionReason.INVALID_ARCHIVE
};
function receiptMessage({
  commandId,
  outcome
}) {
  if (outcome.kind === "rejected") {
    return {
      commandId,
      outcome: { case: "rejected", value: { reason: rejectionCodes[outcome.reason] } }
    };
  }
  const { boardId, title } = outcome;
  return { commandId, outcome: { case: "imported", value: { boardId, title } } };
}
function createArchiveReceiptRoute(application) {
  return unaryRoute(BoardArchiveService.method.getArchiveImportReceipt, ({ id }, { commandId }) => {
    const receipt = application.getReceipt(id, commandId);
    return {
      result: receipt ? { case: "receipt", value: receiptMessage(receipt) } : { case: "notRecorded", value: { commandId } }
    };
  });
}
async function* archiveChunks(request) {
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    const chunk = value;
    if (!Buffer3.isBuffer(chunk)) {
      throw new TypeError("Expected a binary archive request.");
    }
    yield chunk;
  }
}
async function importArchive(application, actor, request, response) {
  if (mediaType(request) !== archiveContentType) {
    sendStatus(response, 415);
    return;
  }
  if (Number(request.headers["content-length"]) > MAX_ARCHIVE_IMPORT_BYTES) {
    throw new HttpRequestError(413, "Archive exceeds the size limit.");
  }
  const commandId = request.headers[commandHeader];
  if (typeof commandId !== "string") {
    throw new HttpRequestError(400, "Archive command identifier is required.");
  }
  const receipt = await application.importCurrent(actor.id, commandId, archiveChunks(request));
  if (receipt.outcome.kind === "rejected" && receipt.outcome.reason === "tooLarge") {
    sendStatus(response, 413);
    return;
  }
  const schema2 = ImportBoardArchiveResponseSchema;
  sendProtobuf(response, toBinary(schema2, create(schema2, { receipt: receiptMessage(receipt) })));
}
function serveArchiveAsset(application, actor, path2, response) {
  const [boardId, assetId, extra] = path2.slice(archiveAssetPrefix.length).split("/");
  if (!boardId || !assetId || extra !== void 0) {
    sendStatus(response, 404);
    return;
  }
  actor.authorize?.({ boardId });
  const asset = application.getAsset(actor.id, boardId, assetId);
  if (!asset) {
    sendStatus(response, 404);
    return;
  }
  response.writeHead(200, {
    "content-type": asset.mimeType,
    "content-length": asset.bytes.byteLength,
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff"
  });
  response.end(asset.bytes);
}
function archiveRoute(path2, application) {
  if (path2 === archiveImportPath) {
    return {
      method: "POST",
      run: (actor, request, response) => importArchive(application, actor, request, response)
    };
  }
  if (path2.startsWith(archiveAssetPrefix)) {
    return {
      method: "GET",
      run: (actor, _request, response) => serveArchiveAsset(application, actor, path2, response)
    };
  }
  return void 0;
}

// ../../packages/contracts/dist/proto/luming/studio/v1/board_catalog_service_pb.js
var file_luming_studio_v1_board_catalog_service = /* @__PURE__ */ fileDesc("CixsdW1pbmcvc3R1ZGlvL3YxL2JvYXJkX2NhdGFsb2dfc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSK3AQoMQm9hcmRTdW1tYXJ5EhAKCGJvYXJkX2lkGAEgASgJEg0KBXRpdGxlGAIgASgJEh4KEXVwZGF0ZWRfYXRfbWlsbGlzGAMgASgESACIAQESDgoGcGlubmVkGAQgASgIEhoKDWVudHJ5X3ZlcnNpb24YBSABKARIAYgBARISCgpjYW5fbWFuYWdlGAYgASgIQhQKEl91cGRhdGVkX2F0X21pbGxpc0IQCg5fZW50cnlfdmVyc2lvbiKGAQoRTGlzdEJvYXJkc1JlcXVlc3QSDQoFcXVlcnkYASABKAkSLwoFb3JkZXIYAiABKA4yIC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU29ydE9yZGVyEhEKCXBhZ2Vfc2l6ZRgDIAEoDRITCgZjdXJzb3IYBCABKAlIAIgBAUIJCgdfY3Vyc29yIm4KEkxpc3RCb2FyZHNSZXNwb25zZRIuCgZib2FyZHMYASADKAsyHi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VtbWFyeRIYCgtuZXh0X2N1cnNvchgCIAEoCUgAiAEBQg4KDF9uZXh0X2N1cnNvciJfChNUcmFzaGVkQm9hcmRTdW1tYXJ5Ei0KBWJvYXJkGAEgASgLMh4ubHVtaW5nLnN0dWRpby52MS5Cb2FyZFN1bW1hcnkSGQoRdHJhc2hlZF9hdF9taWxsaXMYAiABKAQijQEKGExpc3RUcmFzaGVkQm9hcmRzUmVxdWVzdBINCgVxdWVyeRgBIAEoCRIvCgVvcmRlchgCIAEoDjIgLmx1bWluZy5zdHVkaW8udjEuQm9hcmRTb3J0T3JkZXISEQoJcGFnZV9zaXplGAMgASgNEhMKBmN1cnNvchgEIAEoCUgAiAEBQgkKB19jdXJzb3IifAoZTGlzdFRyYXNoZWRCb2FyZHNSZXNwb25zZRI1CgZib2FyZHMYASADKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLlRyYXNoZWRCb2FyZFN1bW1hcnkSGAoLbmV4dF9jdXJzb3IYAiABKAlIAIgBAUIOCgxfbmV4dF9jdXJzb3IiNwoSQ3JlYXRlQm9hcmRSZXF1ZXN0EhIKCmNvbW1hbmRfaWQYASABKAkSDQoFdGl0bGUYAiABKAkiTwoTQ3JlYXRlQm9hcmRSZXNwb25zZRI4CgdyZWNlaXB0GAEgASgLMicubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nQ29tbWFuZFJlY2VpcHQiRAoVRHVwbGljYXRlQm9hcmRSZXF1ZXN0EhIKCmNvbW1hbmRfaWQYASABKAkSFwoPc291cmNlX2JvYXJkX2lkGAIgASgJIlIKFkR1cGxpY2F0ZUJvYXJkUmVzcG9uc2USOAoHcmVjZWlwdBgBIAEoCzInLmx1bWluZy5zdHVkaW8udjEuQ2F0YWxvZ0NvbW1hbmRSZWNlaXB0IucBChJNYW5hZ2VCb2FyZFJlcXVlc3QSEgoKY29tbWFuZF9pZBgBIAEoCRIQCghib2FyZF9pZBgCIAEoCRIjChZleHBlY3RlZF9lbnRyeV92ZXJzaW9uGAMgASgESAGIAQESDwoFdGl0bGUYBCABKAlIABIQCgZwaW5uZWQYBSABKAhIABI7CglsaWZlY3ljbGUYBiABKA4yJi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkTGlmZWN5Y2xlQWN0aW9uSABCCwoJb3BlcmF0aW9uQhkKF19leHBlY3RlZF9lbnRyeV92ZXJzaW9uIk8KE01hbmFnZUJvYXJkUmVzcG9uc2USOAoHcmVjZWlwdBgBIAEoCzInLmx1bWluZy5zdHVkaW8udjEuQ2F0YWxvZ0NvbW1hbmRSZWNlaXB0ImQKEFB1cmdlQm9hcmRUYXJnZXQSEAoIYm9hcmRfaWQYASABKAkSIwoWZXhwZWN0ZWRfZW50cnlfdmVyc2lvbhgCIAEoBEgAiAEBQhkKF19leHBlY3RlZF9lbnRyeV92ZXJzaW9uIl0KElB1cmdlQm9hcmRzUmVxdWVzdBISCgpjb21tYW5kX2lkGAEgASgJEjMKB3RhcmdldHMYAiADKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLlB1cmdlQm9hcmRUYXJnZXQiTwoTUHVyZ2VCb2FyZHNSZXNwb25zZRI4CgdyZWNlaXB0GAEgASgLMicubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nQ29tbWFuZFJlY2VpcHQigAEKFkNhdGFsb2dQdXJnZUl0ZW1SZXN1bHQSEAoIYm9hcmRfaWQYASABKAkSEQoHZGVsZXRlZBgCIAEoCEgAEjYKCHJlamVjdGVkGAMgASgLMiIubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nUmVqZWN0aW9uSABCCQoHb3V0Y29tZSJNChJDYXRhbG9nUHVyZ2VSZXN1bHQSNwoFaXRlbXMYASADKAsyKC5sdW1pbmcuc3R1ZGlvLnYxLkNhdGFsb2dQdXJnZUl0ZW1SZXN1bHQijAIKFUNhdGFsb2dDb21tYW5kUmVjZWlwdBISCgpjb21tYW5kX2lkGAEgASgJEjEKB2NyZWF0ZWQYAiABKAsyHi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VtbWFyeUgAEjYKCHJlamVjdGVkGAMgASgLMiIubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nUmVqZWN0aW9uSAASMQoHY2hhbmdlZBgEIAEoCzIeLmx1bWluZy5zdHVkaW8udjEuQm9hcmRTdW1tYXJ5SAASNgoGcHVyZ2VkGAUgASgLMiQubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nUHVyZ2VSZXN1bHRIAEIJCgdvdXRjb21lIkwKEENhdGFsb2dSZWplY3Rpb24SOAoGcmVhc29uGAEgASgOMigubHVtaW5nLnN0dWRpby52MS5DYXRhbG9nUmVqZWN0aW9uUmVhc29uIjUKH0dldENhdGFsb2dDb21tYW5kUmVjZWlwdFJlcXVlc3QSEgoKY29tbWFuZF9pZBgBIAEoCSIvChlDYXRhbG9nUmVjZWlwdE5vdFJlY29yZGVkEhIKCmNvbW1hbmRfaWQYASABKAkirQEKIEdldENhdGFsb2dDb21tYW5kUmVjZWlwdFJlc3BvbnNlEjoKB3JlY2VpcHQYASABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLkNhdGFsb2dDb21tYW5kUmVjZWlwdEgAEkMKDG5vdF9yZWNvcmRlZBgCIAEoCzIrLmx1bWluZy5zdHVkaW8udjEuQ2F0YWxvZ1JlY2VpcHROb3RSZWNvcmRlZEgAQggKBnJlc3VsdCprCg5Cb2FyZFNvcnRPcmRlchIgChxCT0FSRF9TT1JUX09SREVSX1VOU1BFQ0lGSUVEEAASGwoXQk9BUkRfU09SVF9PUkRFUl9SRUNFTlQQARIaChZCT0FSRF9TT1JUX09SREVSX1RJVExFEAIqhAEKFEJvYXJkTGlmZWN5Y2xlQWN0aW9uEiYKIkJPQVJEX0xJRkVDWUNMRV9BQ1RJT05fVU5TUEVDSUZJRUQQABIgChxCT0FSRF9MSUZFQ1lDTEVfQUNUSU9OX1RSQVNIEAESIgoeQk9BUkRfTElGRUNZQ0xFX0FDVElPTl9SRVNUT1JFEAIq0wIKFkNhdGFsb2dSZWplY3Rpb25SZWFzb24SKAokQ0FUQUxPR19SRUpFQ1RJT05fUkVBU09OX1VOU1BFQ0lGSUVEEAASKgomQ0FUQUxPR19SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfVElUTEUQARItCilDQVRBTE9HX1JFSkVDVElPTl9SRUFTT05fQ09NTUFORF9JRF9SRVVTRRACEiYKIkNBVEFMT0dfUkVKRUNUSU9OX1JFQVNPTl9GT1JCSURERU4QAxIyCi5DQVRBTE9HX1JFSkVDVElPTl9SRUFTT05fRU5UUllfVkVSU0lPTl9DSEFOR0VEEAQSKgomQ0FUQUxPR19SRUpFQ1RJT05fUkVBU09OX1NUQVRFX0NIQU5HRUQQBRIsCihDQVRBTE9HX1JFSkVDVElPTl9SRUFTT05fSU5WQUxJRF9DT01NQU5EEAYy2QUKE0JvYXJkQ2F0YWxvZ1NlcnZpY2USVwoKTGlzdEJvYXJkcxIjLmx1bWluZy5zdHVkaW8udjEuTGlzdEJvYXJkc1JlcXVlc3QaJC5sdW1pbmcuc3R1ZGlvLnYxLkxpc3RCb2FyZHNSZXNwb25zZRJsChFMaXN0VHJhc2hlZEJvYXJkcxIqLmx1bWluZy5zdHVkaW8udjEuTGlzdFRyYXNoZWRCb2FyZHNSZXF1ZXN0GisubHVtaW5nLnN0dWRpby52MS5MaXN0VHJhc2hlZEJvYXJkc1Jlc3BvbnNlEloKC0NyZWF0ZUJvYXJkEiQubHVtaW5nLnN0dWRpby52MS5DcmVhdGVCb2FyZFJlcXVlc3QaJS5sdW1pbmcuc3R1ZGlvLnYxLkNyZWF0ZUJvYXJkUmVzcG9uc2USYwoORHVwbGljYXRlQm9hcmQSJy5sdW1pbmcuc3R1ZGlvLnYxLkR1cGxpY2F0ZUJvYXJkUmVxdWVzdBooLmx1bWluZy5zdHVkaW8udjEuRHVwbGljYXRlQm9hcmRSZXNwb25zZRJaCgtNYW5hZ2VCb2FyZBIkLmx1bWluZy5zdHVkaW8udjEuTWFuYWdlQm9hcmRSZXF1ZXN0GiUubHVtaW5nLnN0dWRpby52MS5NYW5hZ2VCb2FyZFJlc3BvbnNlEloKC1B1cmdlQm9hcmRzEiQubHVtaW5nLnN0dWRpby52MS5QdXJnZUJvYXJkc1JlcXVlc3QaJS5sdW1pbmcuc3R1ZGlvLnYxLlB1cmdlQm9hcmRzUmVzcG9uc2USgQEKGEdldENhdGFsb2dDb21tYW5kUmVjZWlwdBIxLmx1bWluZy5zdHVkaW8udjEuR2V0Q2F0YWxvZ0NvbW1hbmRSZWNlaXB0UmVxdWVzdBoyLmx1bWluZy5zdHVkaW8udjEuR2V0Q2F0YWxvZ0NvbW1hbmRSZWNlaXB0UmVzcG9uc2ViBnByb3RvMw");
var CatalogCommandReceiptSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_board_catalog_service, 17);
var BoardSortOrderSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_catalog_service, 0);
var BoardSortOrder = /* @__PURE__ */ tsEnum(BoardSortOrderSchema);
var BoardLifecycleActionSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_catalog_service, 1);
var BoardLifecycleAction = /* @__PURE__ */ tsEnum(BoardLifecycleActionSchema);
var CatalogRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_catalog_service, 2);
var CatalogRejectionReason = /* @__PURE__ */ tsEnum(CatalogRejectionReasonSchema);
var BoardCatalogService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_board_catalog_service, 0);

// src/entrypoints/http/catalog-routes.ts
var catalogRejections = {
  invalidTitle: CatalogRejectionReason.INVALID_TITLE,
  commandIdReuse: CatalogRejectionReason.COMMAND_ID_REUSE,
  forbidden: CatalogRejectionReason.FORBIDDEN,
  entryVersionChanged: CatalogRejectionReason.ENTRY_VERSION_CHANGED,
  stateChanged: CatalogRejectionReason.STATE_CHANGED,
  invalidCommand: CatalogRejectionReason.INVALID_COMMAND
};
function toSortOrder(order) {
  switch (order) {
    case BoardSortOrder.UNSPECIFIED:
    case BoardSortOrder.RECENT:
      return "recent";
    case BoardSortOrder.TITLE:
      return "title";
    default:
      throw new HttpRequestError(400, "Unsupported board sort order");
  }
}
function toReceiptOutcome(receipt) {
  switch (receipt.kind) {
    case "created":
      return { case: "created", value: receipt.board };
    case "changed":
      return { case: "changed", value: receipt.board };
    case "purged":
      return {
        case: "purged",
        value: {
          items: receipt.items.map((item) => ({
            boardId: item.boardId,
            outcome: item.deleted ? { case: "deleted", value: true } : { case: "rejected", value: { reason: catalogRejections[item.reason] } }
          }))
        }
      };
    case "rejected":
      return { case: "rejected", value: { reason: catalogRejections[receipt.reason] } };
  }
}
function toCatalogReceipt(receipt) {
  return create(CatalogCommandReceiptSchema, {
    commandId: receipt.commandId,
    outcome: toReceiptOutcome(receipt)
  });
}
function requireEntryVersion(value) {
  if (value === void 0) {
    throw new HttpRequestError(400, "Catalogue entry version is required");
  }
  return value;
}
function toManageOperation(operation) {
  switch (operation.case) {
    case "title":
      return { kind: "rename", title: operation.value };
    case "pinned":
      return { kind: "pin", pinned: operation.value };
    case "lifecycle":
      if (operation.value === BoardLifecycleAction.TRASH) {
        return { kind: "trash" };
      }
      if (operation.value === BoardLifecycleAction.RESTORE) {
        return { kind: "restore" };
      }
      throw new HttpRequestError(400, "Unsupported catalogue lifecycle action");
    case void 0:
      throw new HttpRequestError(400, "Catalogue operation is required");
  }
}
function createCatalogRoutes(application) {
  const {
    listBoards: listBoards3,
    listTrashedBoards: listTrashedBoards3,
    createBoard: createBoard2,
    duplicateBoard: duplicateBoard3,
    manageBoard: manageBoard2,
    purgeBoards: purgeBoards2,
    getCatalogCommandReceipt
  } = BoardCatalogService.method;
  return [
    unaryRoute(listBoards3, (actor, request) => {
      const { query, order, pageSize, cursor } = request;
      const result = application.listBoards(actor, {
        query,
        order: toSortOrder(order),
        pageSize,
        cursor
      });
      return { boards: [...result.boards], nextCursor: result.nextCursor };
    }),
    unaryRoute(listTrashedBoards3, (actor, request) => {
      const { query, order, pageSize, cursor } = request;
      const result = application.listTrashedBoards(actor, {
        query,
        order: toSortOrder(order),
        pageSize,
        cursor
      });
      return { boards: [...result.boards], nextCursor: result.nextCursor };
    }),
    unaryRoute(createBoard2, (actor, request) => {
      const receipt = application.createBoard(actor, {
        commandId: requireId(request.commandId),
        title: request.title
      });
      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(duplicateBoard3, (actor, request) => {
      const receipt = application.duplicateBoard(actor, {
        commandId: requireId(request.commandId),
        sourceBoardId: requireId(request.sourceBoardId)
      });
      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(manageBoard2, (actor, request) => {
      const receipt = application.manageBoard(actor, {
        commandId: requireId(request.commandId),
        boardId: requireId(request.boardId),
        expectedEntryVersion: requireEntryVersion(request.expectedEntryVersion),
        operation: toManageOperation(request.operation)
      });
      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(purgeBoards2, (actor, request) => {
      const receipt = application.purgeBoards(actor, {
        commandId: requireId(request.commandId),
        targets: request.targets.map(({ boardId, expectedEntryVersion }) => ({
          boardId: requireId(boardId),
          expectedEntryVersion: requireEntryVersion(expectedEntryVersion)
        }))
      });
      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(getCatalogCommandReceipt, (actor, request) => {
      const commandId = requireId(request.commandId);
      const receipt = application.getReceipt(actor, commandId);
      return {
        result: receipt ? { case: "receipt", value: toCatalogReceipt(receipt) } : { case: "notRecorded", value: { commandId } }
      };
    })
  ];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/whiteboard_scene_pb.js
var file_luming_studio_v1_whiteboard_scene = /* @__PURE__ */ fileDesc("CidsdW1pbmcvc3R1ZGlvL3YxL3doaXRlYm9hcmRfc2NlbmUucHJvdG8SEGx1bWluZy5zdHVkaW8udjEivwEKCkJvYXJkU2NlbmUSEAoIYm9hcmRfaWQYASABKAkSDQoFdGl0bGUYAiABKAkSGwoOYm9hcmRfcmV2aXNpb24YAyABKARIAIgBARIxCgdvYmplY3RzGAQgAygLMiAubHVtaW5nLnN0dWRpby52MS5PYmplY3RNZXRhZGF0YRItCgZhY2Nlc3MYBSABKAsyHS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkQWNjZXNzQhEKD19ib2FyZF9yZXZpc2lvbiIfCgtCb2FyZEFjY2VzcxIQCghjYW5fZWRpdBgBIAEoCCLJBAoOT2JqZWN0TWV0YWRhdGESEQoJb2JqZWN0X2lkGAEgASgJEgwKBGtpbmQYAiABKAkSDQoFbGFiZWwYAyABKAkSLAoIZ2VvbWV0cnkYBCABKAsyGi5sdW1pbmcuc3R1ZGlvLnYxLkdlb21ldHJ5Eh0KEGdlb21ldHJ5X3ZlcnNpb24YBSABKARIAYgBARIcCg9wYXlsb2FkX3ZlcnNpb24YBiABKARIAogBARIOCgZsb2NrZWQYByABKAgSFgoJcGFyZW50X2lkGAggASgJSAOIAQESFQoIZ3JvdXBfaWQYCSABKAlIBIgBARI2CgphcHBlYXJhbmNlGAogASgLMiIubHVtaW5nLnN0dWRpby52MS5PYmplY3RBcHBlYXJhbmNlEjAKBXNoYXBlGAsgASgLMh8ubHVtaW5nLnN0dWRpby52MS5TaGFwZUdlb21ldHJ5SAASNAoHc2VjdGlvbhgMIAEoCzIhLmx1bWluZy5zdHVkaW8udjEuU2VjdGlvbkdlb21ldHJ5SAASLAoDaW5rGA0gASgLMh0ubHVtaW5nLnN0dWRpby52MS5JbmtHZW9tZXRyeUgAEjgKCWNvbm5lY3RvchgOIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9yR2VvbWV0cnlIAEIRCg9nZW9tZXRyeV9kZXRhaWxCEwoRX2dlb21ldHJ5X3ZlcnNpb25CEgoQX3BheWxvYWRfdmVyc2lvbkIMCgpfcGFyZW50X2lkQgsKCV9ncm91cF9pZCJRCghHZW9tZXRyeRIJCgF4GAEgASgBEgkKAXkYAiABKAESDQoFd2lkdGgYAyABKAESDgoGaGVpZ2h0GAQgASgBEhAKCHJvdGF0aW9uGAUgASgBIh0KBVBvaW50EgkKAXgYASABKAESCQoBeRgCIAEoASKaAQoQT2JqZWN0QXBwZWFyYW5jZRIRCgRmaWxsGAEgASgJSACIAQESEwoGc3Ryb2tlGAIgASgJSAGIAQESGQoMc3Ryb2tlX3dpZHRoGAMgASgBSAKIAQESDgoGZGFzaGVkGAQgASgIEg4KBmhvbGxvdxgFIAEoCEIHCgVfZmlsbEIJCgdfc3Ryb2tlQg8KDV9zdHJva2Vfd2lkdGgiIAoNU2hhcGVHZW9tZXRyeRIPCgdvdXRsaW5lGAEgASgJIiYKD1NlY3Rpb25HZW9tZXRyeRITCgt0cmFuc3BhcmVudBgBIAEoCCIcCgtJbmtHZW9tZXRyeRINCgV3aWR0aBgBIAEoASLxAgoRQ29ubmVjdG9yR2VvbWV0cnkSMgoFc3RhcnQYASABKAsyIy5sdW1pbmcuc3R1ZGlvLnYxLkNvbm5lY3RvckVuZHBvaW50EjAKA2VuZBgCIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9yRW5kcG9pbnQSJgoFYmVuZHMYAyADKAsyFy5sdW1pbmcuc3R1ZGlvLnYxLlBvaW50EjcKDnJlbGF0aXZlX2JlbmRzGAQgASgLMh8ubHVtaW5nLnN0dWRpby52MS5SZWxhdGl2ZUJlbmRzEi0KDGxhYmVsX29mZnNldBgFIAEoCzIXLmx1bWluZy5zdHVkaW8udjEuUG9pbnQSMwoKc3RhcnRfaGVhZBgGIAEoDjIfLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9ySGVhZBIxCghlbmRfaGVhZBgHIAEoDjIfLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9ySGVhZCJ2ChFDb25uZWN0b3JFbmRwb2ludBImCgVwb2ludBgBIAEoCzIXLmx1bWluZy5zdHVkaW8udjEuUG9pbnQSOQoKYXR0YWNobWVudBgCIAEoCzIlLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9yQXR0YWNobWVudCJXChNDb25uZWN0b3JBdHRhY2htZW50EhEKCW9iamVjdF9pZBgBIAEoCRItCgRwb3J0GAIgASgOMh8ubHVtaW5nLnN0dWRpby52MS5Db25uZWN0b3JQb3J0IlAKDVJlbGF0aXZlQmVuZHMSLgoKZmlyc3RfYXhpcxgBIAEoDjIaLmx1bWluZy5zdHVkaW8udjEuQmVuZEF4aXMSDwoHb2Zmc2V0cxgCIAMoASqVAQoNQ29ubmVjdG9yUG9ydBIeChpDT05ORUNUT1JfUE9SVF9VTlNQRUNJRklFRBAAEhYKEkNPTk5FQ1RPUl9QT1JUX1RPUBABEhkKFUNPTk5FQ1RPUl9QT1JUX0JPVFRPTRACEhcKE0NPTk5FQ1RPUl9QT1JUX0xFRlQQAxIYChRDT05ORUNUT1JfUE9SVF9SSUdIVBAEKn0KDUNvbm5lY3RvckhlYWQSHgoaQ09OTkVDVE9SX0hFQURfVU5TUEVDSUZJRUQQABIXChNDT05ORUNUT1JfSEVBRF9OT05FEAESGAoUQ09OTkVDVE9SX0hFQURfQVJST1cQAhIZChVDT05ORUNUT1JfSEVBRF9DSVJDTEUQAypXCghCZW5kQXhpcxIZChVCRU5EX0FYSVNfVU5TUEVDSUZJRUQQABIYChRCRU5EX0FYSVNfSE9SSVpPTlRBTBABEhYKEkJFTkRfQVhJU19WRVJUSUNBTBACYgZwcm90bzM");
var BoardSceneSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_scene, 0);
var ObjectMetadataSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_scene, 2);
var ConnectorPortSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_scene, 0);
var ConnectorPort = /* @__PURE__ */ tsEnum(ConnectorPortSchema);
var ConnectorHeadSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_scene, 1);
var ConnectorHead = /* @__PURE__ */ tsEnum(ConnectorHeadSchema);
var BendAxisSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_scene, 2);
var BendAxis = /* @__PURE__ */ tsEnum(BendAxisSchema);

// ../../packages/contracts/dist/proto/luming/studio/v1/whiteboard_payload_pb.js
var file_luming_studio_v1_whiteboard_payload = /* @__PURE__ */ fileDesc("CilsdW1pbmcvc3R1ZGlvL3YxL3doaXRlYm9hcmRfcGF5bG9hZC5wcm90bxIQbHVtaW5nLnN0dWRpby52MSLsBAoNT2JqZWN0UGF5bG9hZBIcCg9wYXlsb2FkX3ZlcnNpb24YASABKARIAYgBARItCgR0ZXh0GAIgASgLMh0ubHVtaW5nLnN0dWRpby52MS5UZXh0UGF5bG9hZEgAEjUKCGRvY3VtZW50GAMgASgLMiEubHVtaW5nLnN0dWRpby52MS5Eb2N1bWVudFBheWxvYWRIABIvCgVlbWJlZBgEIAEoCzIeLmx1bWluZy5zdHVkaW8udjEuRW1iZWRQYXlsb2FkSAASLQoEdG9kbxgFIAEoCzIdLmx1bWluZy5zdHVkaW8udjEuVG9kb1BheWxvYWRIABIvCgV0YWJsZRgGIAEoCzIeLmx1bWluZy5zdHVkaW8udjEuVGFibGVQYXlsb2FkSAASLwoFaW1hZ2UYByABKAsyHi5sdW1pbmcuc3R1ZGlvLnYxLkltYWdlUGF5bG9hZEgAEi8KBXZpZGVvGAggASgLMh4ubHVtaW5nLnN0dWRpby52MS5WaWRlb1BheWxvYWRIABItCgRsaW5rGAkgASgLMh0ubHVtaW5nLnN0dWRpby52MS5MaW5rUGF5bG9hZEgAEjMKB3N0aWNrZXIYCiABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLlN0aWNrZXJQYXlsb2FkSAASKwoDaW5rGAsgASgLMhwubHVtaW5nLnN0dWRpby52MS5JbmtQYXlsb2FkSAASNwoJZXh0ZW5zaW9uGAwgASgLMiIubHVtaW5nLnN0dWRpby52MS5FeHRlbnNpb25QYXlsb2FkSABCBgoEYm9keUISChBfcGF5bG9hZF92ZXJzaW9uIrkBCgtUZXh0UGF5bG9hZBIMCgR0ZXh0GAEgASgJEhIKBWNvbG9yGAIgASgJSACIAQESGAoLZm9udF9mYW1pbHkYAyABKAlIAYgBARIWCglmb250X3NpemUYBCABKAFIAogBARIuCgVhbGlnbhgFIAEoDjIfLmx1bWluZy5zdHVkaW8udjEuVGV4dEFsaWdubWVudEIICgZfY29sb3JCDgoMX2ZvbnRfZmFtaWx5QgwKCl9mb250X3NpemUiaQoPRG9jdW1lbnRQYXlsb2FkEg0KBXRpdGxlGAEgASgJEhYKDnNjaGVtYV92ZXJzaW9uGAIgASgNEi8KBmJsb2NrcxgDIAMoCzIfLmx1bWluZy5zdHVkaW8udjEuRG9jdW1lbnRCbG9jayKzAQoNRG9jdW1lbnRCbG9jaxIQCghibG9ja19pZBgBIAEoCRIMCgR0eXBlGAIgASgJEiYKBXByb3BzGAMgASgLMhcuZ29vZ2xlLnByb3RvYnVmLlN0cnVjdBInCgdjb250ZW50GAQgASgLMhYuZ29vZ2xlLnByb3RvYnVmLlZhbHVlEjEKCGNoaWxkcmVuGAUgAygLMh8ubHVtaW5nLnN0dWRpby52MS5Eb2N1bWVudEJsb2NrIqEBCgxFbWJlZFBheWxvYWQSEgoFdGl0bGUYASABKAlIAIgBARIRCgRodG1sGAIgASgJSAGIAQESHAoPc291cmNlX3JldmlzaW9uGAMgASgESAKIAQESJQoFc3RhdGUYBCABKAsyFi5nb29nbGUucHJvdG9idWYuVmFsdWVCCAoGX3RpdGxlQgcKBV9odG1sQhIKEF9zb3VyY2VfcmV2aXNpb24iRwoLVG9kb1BheWxvYWQSDQoFdGl0bGUYASABKAkSKQoFaXRlbXMYAiADKAsyGi5sdW1pbmcuc3R1ZGlvLnYxLlRvZG9JdGVtIm8KCFRvZG9JdGVtEg8KB2l0ZW1faWQYASABKAkSDAoEdGV4dBgCIAEoCRIPCgdjaGVja2VkGAMgASgIEjMKCnNvdXJjZV9yZWYYBCABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLlRvZG9Tb3VyY2VSZWYirgEKDVRvZG9Tb3VyY2VSZWYSFQoIYm9hcmRfaWQYASABKAlIAIgBARIRCglvYmplY3RfaWQYAiABKAkSFQoIYmxvY2tfaWQYAyABKAlIAYgBARIUCgdpdGVtX2lkGAQgASgJSAKIAQESFAoHdmVyc2lvbhgFIAEoBEgDiAEBQgsKCV9ib2FyZF9pZEILCglfYmxvY2tfaWRCCgoIX2l0ZW1faWRCCgoIX3ZlcnNpb24iVQoMVGFibGVQYXlsb2FkEhEKBHRleHQYASABKAlIAIgBARIpCgRncmlkGAIgASgLMhsubHVtaW5nLnN0dWRpby52MS5UYWJsZUdyaWRCBwoFX3RleHQijQEKCVRhYmxlR3JpZBIoCgRyb3dzGAEgAygLMhoubHVtaW5nLnN0dWRpby52MS5UYWJsZVJvdxIPCgdyb3dfaWRzGAIgAygJEhIKCmNvbHVtbl9pZHMYAyADKAkSFQoNY29sdW1uX3dpZHRocxgEIAMoARIRCgRoZWFkGAUgASgISACIAQFCBwoFX2hlYWQiNgoIVGFibGVSb3cSKgoFY2VsbHMYASADKAsyGy5sdW1pbmcuc3R1ZGlvLnYxLlRhYmxlQ2VsbCJ+CglUYWJsZUNlbGwSDgoEdGV4dBgBIAEoCUgAEhAKBm51bWJlchgCIAEoAUgAEhQKCmJvb2xfdmFsdWUYAyABKAhIABIwCgpudWxsX3ZhbHVlGAQgASgOMhouZ29vZ2xlLnByb3RvYnVmLk51bGxWYWx1ZUgAQgcKBXZhbHVlIqIBCgxJbWFnZVBheWxvYWQSEAoDc3JjGAEgASgJSACIAQESEQoEaHJlZhgCIAEoCUgBiAEBEikKBGNyb3AYAyABKAsyGy5sdW1pbmcuc3R1ZGlvLnYxLkltYWdlQ3JvcBIxCgxuYXR1cmFsX3NpemUYBCABKAsyGy5sdW1pbmcuc3R1ZGlvLnYxLkltYWdlU2l6ZUIGCgRfc3JjQgcKBV9ocmVmIi8KCUltYWdlQ3JvcBIMCgR6b29tGAEgASgBEgkKAXgYAiABKAESCQoBeRgDIAEoASIqCglJbWFnZVNpemUSDQoFd2lkdGgYASABKA0SDgoGaGVpZ2h0GAIgASgNIkgKDFZpZGVvUGF5bG9hZBIQCgNzcmMYASABKAlIAIgBARITCgZwb3N0ZXIYAiABKAlIAYgBAUIGCgRfc3JjQgkKB19wb3N0ZXIiKQoLTGlua1BheWxvYWQSEQoEaHJlZhgBIAEoCUgAiAEBQgcKBV9ocmVmIlwKDlN0aWNrZXJQYXlsb2FkEhcKCnN0aWNrZXJfaWQYASABKAlIAIgBARIVCghmYWxsYmFjaxgCIAEoCUgBiAEBQg0KC19zdGlja2VyX2lkQgsKCV9mYWxsYmFjayI1CgpJbmtQYXlsb2FkEicKBnBvaW50cxgBIAMoCzIXLmx1bWluZy5zdHVkaW8udjEuUG9pbnQiMwoQRXh0ZW5zaW9uUGF5bG9hZBIRCglzY2hlbWFfaWQYASABKAkSDAoEZGF0YRgCIAEoDCp9Cg1UZXh0QWxpZ25tZW50Eh4KGlRFWFRfQUxJR05NRU5UX1VOU1BFQ0lGSUVEEAASFwoTVEVYVF9BTElHTk1FTlRfTEVGVBABEhkKFVRFWFRfQUxJR05NRU5UX0NFTlRFUhACEhgKFFRFWFRfQUxJR05NRU5UX1JJR0hUEANiBnByb3RvMw", [file_google_protobuf_struct, file_luming_studio_v1_whiteboard_scene]);
var ObjectPayloadSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_payload, 0);
var TextPayloadSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_payload, 1);
var DocumentPayloadSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_payload, 2);
var TablePayloadSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_payload, 8);

// ../../packages/contracts/dist/proto/luming/studio/v1/whiteboard_service_pb.js
var file_luming_studio_v1_whiteboard_service = /* @__PURE__ */ fileDesc("CilsdW1pbmcvc3R1ZGlvL3YxL3doaXRlYm9hcmRfc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSKMAgoSRXhwb3J0Qm9hcmRSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEh4KEWV4cGVjdGVkX3JldmlzaW9uGAIgASgESAGIAQESMwoFd2hvbGUYAyABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydFdob2xlQm9hcmRIABI7CglzZWxlY3Rpb24YBCABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkU2VsZWN0aW9uSAASMwoGZm9ybWF0GAUgASgOMiMubHVtaW5nLnN0dWRpby52MS5Cb2FyZEV4cG9ydEZvcm1hdEIHCgVzY29wZUIUChJfZXhwZWN0ZWRfcmV2aXNpb24iEgoQRXhwb3J0V2hvbGVCb2FyZCIqChRFeHBvcnRCb2FyZFNlbGVjdGlvbhISCgpvYmplY3RfaWRzGAEgAygJIsIBChNFeHBvcnRCb2FyZFJlc3BvbnNlEjEKBGZpbGUYASABKAsyIS5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkRmlsZUgAEjMKBXN0YWxlGAIgASgLMiIubHVtaW5nLnN0dWRpby52MS5FeHBvcnRCb2FyZFN0YWxlSAASOQoIcmVqZWN0ZWQYAyABKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkUmVqZWN0ZWRIAEIICgZyZXN1bHQiWQoPRXhwb3J0Qm9hcmRGaWxlEhAKCGZpbGVuYW1lGAEgASgJEhEKCW1pbWVfdHlwZRgCIAEoCRIQCghyZXZpc2lvbhgDIAEoBBIPCgdjb250ZW50GAQgASgMIiQKEEV4cG9ydEJvYXJkU3RhbGUSEAoIcmV2aXNpb24YASABKAQiUwoTRXhwb3J0Qm9hcmRSZWplY3RlZBI8CgZyZWFzb24YASABKA4yLC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRXhwb3J0UmVqZWN0aW9uUmVhc29uIigKFEdldEJvYXJkU2NlbmVSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJIkQKFUdldEJvYXJkU2NlbmVSZXNwb25zZRIrCgVzY2VuZRgBIAEoCzIcLmx1bWluZy5zdHVkaW8udjEuQm9hcmRTY2VuZSJAChhHZXRPYmplY3RQYXlsb2Fkc1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKb2JqZWN0X2lkcxgCIAMoCSJlChlHZXRPYmplY3RQYXlsb2Fkc1Jlc3BvbnNlEhAKCGJvYXJkX2lkGAEgASgJEjYKB3Jlc3VsdHMYAiADKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLk9iamVjdFBheWxvYWRSZXN1bHQiqQEKE09iamVjdFBheWxvYWRSZXN1bHQSEQoJb2JqZWN0X2lkGAEgASgJEjIKB3BheWxvYWQYAiABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLk9iamVjdFBheWxvYWRIABJBCgt1bmF2YWlsYWJsZRgDIAEoCzIqLmx1bWluZy5zdHVkaW8udjEuT2JqZWN0UGF5bG9hZFVuYXZhaWxhYmxlSABCCAoGcmVzdWx0IlwKGE9iamVjdFBheWxvYWRVbmF2YWlsYWJsZRJACgZyZWFzb24YASABKA4yMC5sdW1pbmcuc3R1ZGlvLnYxLk9iamVjdFBheWxvYWRVbmF2YWlsYWJsZVJlYXNvbiKVAQoSTW92ZU9iamVjdHNSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhIKCmNvbW1hbmRfaWQYAiABKAkSKgoFZGVsdGEYAyABKAsyGy5sdW1pbmcuc3R1ZGlvLnYxLk1vdmVEZWx0YRItCgd0YXJnZXRzGAQgAygLMhwubHVtaW5nLnN0dWRpby52MS5Nb3ZlVGFyZ2V0IiMKCU1vdmVEZWx0YRIKCgJkeBgBIAEoARIKCgJkeRgCIAEoASJlCgpNb3ZlVGFyZ2V0EhEKCW9iamVjdF9pZBgBIAEoCRImChlleHBlY3RlZF9nZW9tZXRyeV92ZXJzaW9uGAIgASgESACIAQFCHAoaX2V4cGVjdGVkX2dlb21ldHJ5X3ZlcnNpb24iSAoTTW92ZU9iamVjdHNSZXNwb25zZRIxCgdyZWNlaXB0GAEgASgLMiAubHVtaW5nLnN0dWRpby52MS5Db21tYW5kUmVjZWlwdCLbAQoOQ29tbWFuZFJlY2VpcHQSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRIwCgdhcHBsaWVkGAMgASgLMh0ubHVtaW5nLnN0dWRpby52MS5Nb3ZlQXBwbGllZEgAEjIKCGNvbmZsaWN0GAQgASgLMh4ubHVtaW5nLnN0dWRpby52MS5Nb3ZlQ29uZmxpY3RIABIyCghyZWplY3RlZBgFIAEoCzIeLmx1bWluZy5zdHVkaW8udjEuTW92ZVJlamVjdGVkSABCCQoHb3V0Y29tZSJwCgtNb3ZlQXBwbGllZBIbCg5ib2FyZF9yZXZpc2lvbhgBIAEoBEgAiAEBEjEKB29iamVjdHMYAiADKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLk9iamVjdE1ldGFkYXRhQhEKD19ib2FyZF9yZXZpc2lvbiLLAQoMTW92ZUNvbmZsaWN0EjQKBnJlYXNvbhgBIAEoDjIkLmx1bWluZy5zdHVkaW8udjEuTW92ZUNvbmZsaWN0UmVhc29uEhsKDmJvYXJkX3JldmlzaW9uGAIgASgESACIAQESOQoPY3VycmVudF9vYmplY3RzGAMgAygLMiAubHVtaW5nLnN0dWRpby52MS5PYmplY3RNZXRhZGF0YRIaChJtaXNzaW5nX29iamVjdF9pZHMYBCADKAlCEQoPX2JvYXJkX3JldmlzaW9uIkUKDE1vdmVSZWplY3RlZBI1CgZyZWFzb24YASABKA4yJS5sdW1pbmcuc3R1ZGlvLnYxLk1vdmVSZWplY3Rpb25SZWFzb24iQAoYR2V0Q29tbWFuZFJlY2VpcHRSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhIKCmNvbW1hbmRfaWQYAiABKAkinwEKGUdldENvbW1hbmRSZWNlaXB0UmVzcG9uc2USMwoHcmVjZWlwdBgBIAEoCzIgLmx1bWluZy5zdHVkaW8udjEuQ29tbWFuZFJlY2VpcHRIABJDCgxub3RfcmVjb3JkZWQYAiABKAsyKy5sdW1pbmcuc3R1ZGlvLnYxLkNvbW1hbmRSZWNlaXB0Tm90UmVjb3JkZWRIAEIICgZyZXN1bHQiQQoZQ29tbWFuZFJlY2VpcHROb3RSZWNvcmRlZBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJKnMKEUJvYXJkRXhwb3J0Rm9ybWF0EiMKH0JPQVJEX0VYUE9SVF9GT1JNQVRfVU5TUEVDSUZJRUQQABIcChhCT0FSRF9FWFBPUlRfRk9STUFUX0pTT04QARIbChdCT0FSRF9FWFBPUlRfRk9STUFUX1NWRxACKpECChpCb2FyZEV4cG9ydFJlamVjdGlvblJlYXNvbhItCilCT0FSRF9FWFBPUlRfUkVKRUNUSU9OX1JFQVNPTl9VTlNQRUNJRklFRBAAEjMKL0JPQVJEX0VYUE9SVF9SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfU0VMRUNUSU9OEAESLQopQk9BUkRfRVhQT1JUX1JFSkVDVElPTl9SRUFTT05fVU5TVVBQT1JURUQQAhIzCi9CT0FSRF9FWFBPUlRfUkVKRUNUSU9OX1JFQVNPTl9BU1NFVF9VTkFWQUlMQUJMRRADEisKJ0JPQVJEX0VYUE9SVF9SRUpFQ1RJT05fUkVBU09OX1RPT19MQVJHRRAEKrwBCh5PYmplY3RQYXlsb2FkVW5hdmFpbGFibGVSZWFzb24SMQotT0JKRUNUX1BBWUxPQURfVU5BVkFJTEFCTEVfUkVBU09OX1VOU1BFQ0lGSUVEEAASLworT0JKRUNUX1BBWUxPQURfVU5BVkFJTEFCTEVfUkVBU09OX05PVF9GT1VORBABEjYKMk9CSkVDVF9QQVlMT0FEX1VOQVZBSUxBQkxFX1JFQVNPTl9VTlNVUFBPUlRFRF9LSU5EEAIqlwEKEk1vdmVDb25mbGljdFJlYXNvbhIkCiBNT1ZFX0NPTkZMSUNUX1JFQVNPTl9VTlNQRUNJRklFRBAAEjEKLU1PVkVfQ09ORkxJQ1RfUkVBU09OX0dFT01FVFJZX1ZFUlNJT05fQ0hBTkdFRBABEigKJE1PVkVfQ09ORkxJQ1RfUkVBU09OX1RBUkdFVFNfQ0hBTkdFRBACKuABChNNb3ZlUmVqZWN0aW9uUmVhc29uEiUKIU1PVkVfUkVKRUNUSU9OX1JFQVNPTl9VTlNQRUNJRklFRBAAEiMKH01PVkVfUkVKRUNUSU9OX1JFQVNPTl9GT1JCSURERU4QARIpCiVNT1ZFX1JFSkVDVElPTl9SRUFTT05fR0VPTUVUUllfTE9DS0VEEAISJgoiTU9WRV9SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfTU9WRRADEioKJk1PVkVfUkVKRUNUSU9OX1JFQVNPTl9DT01NQU5EX0lEX1JFVVNFEAQyiQQKEVdoaXRlYm9hcmRTZXJ2aWNlEmAKDUdldEJvYXJkU2NlbmUSJi5sdW1pbmcuc3R1ZGlvLnYxLkdldEJvYXJkU2NlbmVSZXF1ZXN0GicubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFNjZW5lUmVzcG9uc2USbAoRR2V0T2JqZWN0UGF5bG9hZHMSKi5sdW1pbmcuc3R1ZGlvLnYxLkdldE9iamVjdFBheWxvYWRzUmVxdWVzdBorLmx1bWluZy5zdHVkaW8udjEuR2V0T2JqZWN0UGF5bG9hZHNSZXNwb25zZRJaCgtNb3ZlT2JqZWN0cxIkLmx1bWluZy5zdHVkaW8udjEuTW92ZU9iamVjdHNSZXF1ZXN0GiUubHVtaW5nLnN0dWRpby52MS5Nb3ZlT2JqZWN0c1Jlc3BvbnNlEmwKEUdldENvbW1hbmRSZWNlaXB0EioubHVtaW5nLnN0dWRpby52MS5HZXRDb21tYW5kUmVjZWlwdFJlcXVlc3QaKy5sdW1pbmcuc3R1ZGlvLnYxLkdldENvbW1hbmRSZWNlaXB0UmVzcG9uc2USWgoLRXhwb3J0Qm9hcmQSJC5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkUmVxdWVzdBolLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0Qm9hcmRSZXNwb25zZWIGcHJvdG8z", [file_luming_studio_v1_whiteboard_payload, file_luming_studio_v1_whiteboard_scene]);
var ObjectPayloadResultSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_service, 11);
var CommandReceiptSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_service, 17);
var BoardExportFormatSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_service, 0);
var BoardExportFormat = /* @__PURE__ */ tsEnum(BoardExportFormatSchema);
var BoardExportRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_service, 1);
var BoardExportRejectionReason = /* @__PURE__ */ tsEnum(BoardExportRejectionReasonSchema);
var ObjectPayloadUnavailableReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_service, 2);
var ObjectPayloadUnavailableReason = /* @__PURE__ */ tsEnum(ObjectPayloadUnavailableReasonSchema);
var MoveConflictReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_service, 3);
var MoveConflictReason = /* @__PURE__ */ tsEnum(MoveConflictReasonSchema);
var MoveRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_service, 4);
var MoveRejectionReason = /* @__PURE__ */ tsEnum(MoveRejectionReasonSchema);
var WhiteboardService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_whiteboard_service, 0);

// ../../packages/contracts/dist/proto/luming/studio/v1/whiteboard_edits_pb.js
var file_luming_studio_v1_whiteboard_edits = /* @__PURE__ */ fileDesc("CidsdW1pbmcvc3R1ZGlvL3YxL3doaXRlYm9hcmRfZWRpdHMucHJvdG8SEGx1bWluZy5zdHVkaW8udjEisgMKGEVkaXRCb2FyZEdlb21ldHJ5UmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJEjUKBmNyZWF0ZRgDIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQ3JlYXRlQm9hcmRPYmplY3RIABI8Cgl0cmFuc2Zvcm0YBCABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLlRyYW5zZm9ybUJvYXJkT2JqZWN0c0gAEj4KC2NoYW5nZV9sb2NrGAUgASgLMicubHVtaW5nLnN0dWRpby52MS5DaGFuZ2VCb2FyZE9iamVjdExvY2tIABI2CgZkZWxldGUYBiABKAsyJC5sdW1pbmcuc3R1ZGlvLnYxLkRlbGV0ZUJvYXJkT2JqZWN0c0gAEjgKB3Jlb3JkZXIYByABKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLlJlb3JkZXJCb2FyZE9iamVjdHNIABI8CglkdXBsaWNhdGUYCCABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLkR1cGxpY2F0ZUJvYXJkT2JqZWN0c0gAQgsKCW9wZXJhdGlvbiJ/ChFDcmVhdGVCb2FyZE9iamVjdBIwCgZvYmplY3QYASABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLk9iamVjdE1ldGFkYXRhEjgKD2luaXRpYWxfcGF5bG9hZBgCIAEoCzIfLmx1bWluZy5zdHVkaW8udjEuT2JqZWN0UGF5bG9hZCJqCg9FZGl0Qm9hcmRUYXJnZXQSEQoJb2JqZWN0X2lkGAEgASgJEiYKGWV4cGVjdGVkX2dlb21ldHJ5X3ZlcnNpb24YAiABKARIAIgBAUIcChpfZXhwZWN0ZWRfZ2VvbWV0cnlfdmVyc2lvbiLaAQoUVHJhbnNmb3JtQm9hcmRPYmplY3QSMQoGdGFyZ2V0GAEgASgLMiEubHVtaW5nLnN0dWRpby52MS5FZGl0Qm9hcmRUYXJnZXQSLAoIZ2VvbWV0cnkYAiABKAsyGi5sdW1pbmcuc3R1ZGlvLnYxLkdlb21ldHJ5EjYKCWNvbm5lY3RvchgDIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQ29ubmVjdG9yR2VvbWV0cnkSKQoDaW5rGAQgASgLMhwubHVtaW5nLnN0dWRpby52MS5JbmtQYXlsb2FkIoQBChVUcmFuc2Zvcm1Cb2FyZE9iamVjdHMSMgoEa2luZBgBIAEoDjIkLmx1bWluZy5zdHVkaW8udjEuQm9hcmRUcmFuc2Zvcm1LaW5kEjcKB29iamVjdHMYAiADKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLlRyYW5zZm9ybUJvYXJkT2JqZWN0IlsKFUNoYW5nZUJvYXJkT2JqZWN0TG9jaxIyCgd0YXJnZXRzGAEgAygLMiEubHVtaW5nLnN0dWRpby52MS5FZGl0Qm9hcmRUYXJnZXQSDgoGbG9ja2VkGAIgASgIIkgKEkRlbGV0ZUJvYXJkT2JqZWN0cxIyCgd0YXJnZXRzGAEgAygLMiEubHVtaW5nLnN0dWRpby52MS5FZGl0Qm9hcmRUYXJnZXQixQEKE1Jlb3JkZXJCb2FyZE9iamVjdHMSMgoHdGFyZ2V0cxgBIAMoCzIhLmx1bWluZy5zdHVkaW8udjEuRWRpdEJvYXJkVGFyZ2V0EjgKCWRpcmVjdGlvbhgCIAEoDjIlLmx1bWluZy5zdHVkaW8udjEuQm9hcmRMYXllckRpcmVjdGlvbhIkChdleHBlY3RlZF9ib2FyZF9yZXZpc2lvbhgDIAEoBEgAiAEBQhoKGF9leHBlY3RlZF9ib2FyZF9yZXZpc2lvbiJgChREdXBsaWNhdGVCb2FyZE9iamVjdBIxCgZzb3VyY2UYASABKAsyIS5sdW1pbmcuc3R1ZGlvLnYxLkVkaXRCb2FyZFRhcmdldBIVCg1uZXdfb2JqZWN0X2lkGAIgASgJInwKFUR1cGxpY2F0ZUJvYXJkT2JqZWN0cxI3Cgd0YXJnZXRzGAEgAygLMiYubHVtaW5nLnN0dWRpby52MS5EdXBsaWNhdGVCb2FyZE9iamVjdBIqCgVkZWx0YRgCIAEoCzIbLmx1bWluZy5zdHVkaW8udjEuTW92ZURlbHRhIlAKGUVkaXRCb2FyZEdlb21ldHJ5UmVzcG9uc2USMwoHcmVjZWlwdBgBIAEoCzIiLmx1bWluZy5zdHVkaW8udjEuQm9hcmRFZGl0UmVjZWlwdCLIBAoYRWRpdE9iamVjdENvbnRlbnRSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhIKCmNvbW1hbmRfaWQYAiABKAkSEQoJb2JqZWN0X2lkGAMgASgJEiUKGGV4cGVjdGVkX3BheWxvYWRfdmVyc2lvbhgEIAEoBEgBiAEBEjUKCGRvY3VtZW50GAUgASgLMiEubHVtaW5nLnN0dWRpby52MS5Eb2N1bWVudFBheWxvYWRIABIrCgR0b2RvGAYgASgLMhsubHVtaW5nLnN0dWRpby52MS5Ub2RvRWRpdHNIABItCgR0ZXh0GAcgASgLMh0ubHVtaW5nLnN0dWRpby52MS5UZXh0UGF5bG9hZEgAEjMKBXRhYmxlGAggASgLMiIubHVtaW5nLnN0dWRpby52MS5TYXZlVGFibGVDb250ZW50SAASOQoMZW1iZWRfc291cmNlGAkgASgLMiEubHVtaW5nLnN0dWRpby52MS5TYXZlRW1iZWRTb3VyY2VIABI3CgtlbWJlZF9zdGF0ZRgKIAEoCzIgLmx1bWluZy5zdHVkaW8udjEuU2F2ZUVtYmVkU3RhdGVIABI5CgdzdGlja2VyGAsgASgLMiYubHVtaW5nLnN0dWRpby52MS5TZWxlY3RTdGlja2VyQ29udGVudEgAEjAKBGNyb3AYDCABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkNyb3BCb2FyZEltYWdlSABCBgoEZWRpdEIbChlfZXhwZWN0ZWRfcGF5bG9hZF92ZXJzaW9uInsKEFNhdmVUYWJsZUNvbnRlbnQSLQoFdGFibGUYASABKAsyHi5sdW1pbmcuc3R1ZGlvLnYxLlRhYmxlUGF5bG9hZBI4Cgx3aWR0aF9jaGFuZ2UYAiABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLlRhYmxlV2lkdGhDaGFuZ2UiOQoQVGFibGVXaWR0aENoYW5nZRIWCg5leHBlY3RlZF93aWR0aBgBIAEoARINCgV3aWR0aBgCIAEoASJyCg9TYXZlRW1iZWRTb3VyY2USDQoFdGl0bGUYASABKAkSDAoEaHRtbBgCIAEoCRIlChhleHBlY3RlZF9zb3VyY2VfcmV2aXNpb24YAyABKARIAIgBAUIbChlfZXhwZWN0ZWRfc291cmNlX3JldmlzaW9uIjcKDlNhdmVFbWJlZFN0YXRlEiUKBXN0YXRlGAEgASgLMhYuZ29vZ2xlLnByb3RvYnVmLlZhbHVlIk4KFFNlbGVjdFN0aWNrZXJDb250ZW50EhIKCnN0aWNrZXJfaWQYASABKAkSFQoIZmFsbGJhY2sYAiABKAlIAIgBAUILCglfZmFsbGJhY2sibgoOQ3JvcEJvYXJkSW1hZ2USKQoEY3JvcBgBIAEoCzIbLmx1bWluZy5zdHVkaW8udjEuSW1hZ2VDcm9wEjEKDG5hdHVyYWxfc2l6ZRgCIAEoCzIbLmx1bWluZy5zdHVkaW8udjEuSW1hZ2VTaXplIjYKCVRvZG9FZGl0cxIpCgVlZGl0cxgBIAMoCzIaLmx1bWluZy5zdHVkaW8udjEuVG9kb0VkaXQi2wEKCFRvZG9FZGl0EhAKBnJlbmFtZRgBIAEoCUgAEjIKBmluc2VydBgCIAEoCzIgLmx1bWluZy5zdHVkaW8udjEuSW5zZXJ0VG9kb0l0ZW1IABIyCgZ1cGRhdGUYAyABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLlVwZGF0ZVRvZG9JdGVtSAASGAoOZGVsZXRlX2l0ZW1faWQYBCABKAlIABIuCgRtb3ZlGAUgASgLMh4ubHVtaW5nLnN0dWRpby52MS5Nb3ZlVG9kb0l0ZW1IAEILCglvcGVyYXRpb24iVwoNVG9kb1BsYWNlbWVudBIPCgVmaXJzdBgBIAEoCEgAEhAKBmFwcGVuZBgCIAEoCEgAEhcKDWFmdGVyX2l0ZW1faWQYAyABKAlIAEIKCghwb3NpdGlvbiJuCg5JbnNlcnRUb2RvSXRlbRIoCgRpdGVtGAEgASgLMhoubHVtaW5nLnN0dWRpby52MS5Ub2RvSXRlbRIyCglwbGFjZW1lbnQYAiABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLlRvZG9QbGFjZW1lbnQivwEKDlVwZGF0ZVRvZG9JdGVtEg8KB2l0ZW1faWQYASABKAkSEQoEdGV4dBgCIAEoCUgBiAEBEhQKB2NoZWNrZWQYAyABKAhIAogBARI1Cgpzb3VyY2VfcmVmGAQgASgLMh8ubHVtaW5nLnN0dWRpby52MS5Ub2RvU291cmNlUmVmSAASFgoMY2xlYXJfc291cmNlGAUgASgISABCDwoNc291cmNlX2NoYW5nZUIHCgVfdGV4dEIKCghfY2hlY2tlZCJTCgxNb3ZlVG9kb0l0ZW0SDwoHaXRlbV9pZBgBIAEoCRIyCglwbGFjZW1lbnQYAiABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLlRvZG9QbGFjZW1lbnQiUAoZRWRpdE9iamVjdENvbnRlbnRSZXNwb25zZRIzCgdyZWNlaXB0GAEgASgLMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZEVkaXRSZWNlaXB0IqcBChdBdHRhY2hCb2FyZEltYWdlUmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJEhEKCW9iamVjdF9pZBgDIAEoCRIUCgxkaXNwbGF5X25hbWUYBCABKAkSLAoIZ2VvbWV0cnkYBSABKAsyGi5sdW1pbmcuc3R1ZGlvLnYxLkdlb21ldHJ5Eg8KB2NvbnRlbnQYBiABKAwiTwoYQXR0YWNoQm9hcmRJbWFnZVJlc3BvbnNlEjMKB3JlY2VpcHQYASABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdFJlY2VpcHQi7AEKEEJvYXJkRWRpdFJlY2VpcHQSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRI1CgdhcHBsaWVkGAMgASgLMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZEVkaXRBcHBsaWVkSAASNwoIY29uZmxpY3QYBCABKAsyIy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdENvbmZsaWN0SAASNwoIcmVqZWN0ZWQYBSABKAsyIy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdFJlamVjdGVkSABCCQoHb3V0Y29tZSKJAgoQQm9hcmRFZGl0QXBwbGllZBIbCg5ib2FyZF9yZXZpc2lvbhgBIAEoBEgAiAEBEjkKD2NoYW5nZWRfb2JqZWN0cxgCIAMoCzIgLmx1bWluZy5zdHVkaW8udjEuT2JqZWN0TWV0YWRhdGESGgoScmVtb3ZlZF9vYmplY3RfaWRzGAMgAygJEhQKDG9iamVjdF9vcmRlchgEIAMoCRI/ChBjaGFuZ2VkX3BheWxvYWRzGAUgAygLMiUubHVtaW5nLnN0dWRpby52MS5PYmplY3RQYXlsb2FkUmVzdWx0EhcKD2RldGFpbHNfZXhwaXJlZBgGIAEoCEIRCg9fYm9hcmRfcmV2aXNpb24ivwEKEUJvYXJkRWRpdENvbmZsaWN0EhsKDmJvYXJkX3JldmlzaW9uGAEgASgESACIAQESOQoPY3VycmVudF9vYmplY3RzGAIgAygLMiAubHVtaW5nLnN0dWRpby52MS5PYmplY3RNZXRhZGF0YRI/ChBjdXJyZW50X3BheWxvYWRzGAMgAygLMiUubHVtaW5nLnN0dWRpby52MS5PYmplY3RQYXlsb2FkUmVzdWx0QhEKD19ib2FyZF9yZXZpc2lvbiJPChFCb2FyZEVkaXRSZWplY3RlZBI6CgZyZWFzb24YASABKA4yKi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdFJlamVjdGlvblJlYXNvbiJCChpHZXRCb2FyZEVkaXRSZWNlaXB0UmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJIlIKG0dldEJvYXJkRWRpdFJlY2VpcHRSZXNwb25zZRIzCgdyZWNlaXB0GAEgASgLMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZEVkaXRSZWNlaXB0Kp4BChJCb2FyZFRyYW5zZm9ybUtpbmQSJAogQk9BUkRfVFJBTlNGT1JNX0tJTkRfVU5TUEVDSUZJRUQQABIfChtCT0FSRF9UUkFOU0ZPUk1fS0lORF9SRVNJWkUQARIfChtCT0FSRF9UUkFOU0ZPUk1fS0lORF9ST1RBVEUQAhIgChxCT0FSRF9UUkFOU0ZPUk1fS0lORF9DT05ORUNUEAMqxAEKE0JvYXJkTGF5ZXJEaXJlY3Rpb24SJQohQk9BUkRfTEFZRVJfRElSRUNUSU9OX1VOU1BFQ0lGSUVEEAASIQodQk9BUkRfTEFZRVJfRElSRUNUSU9OX0ZPUldBUkQQARIiCh5CT0FSRF9MQVlFUl9ESVJFQ1RJT05fQkFDS1dBUkQQAhIfChtCT0FSRF9MQVlFUl9ESVJFQ1RJT05fRlJPTlQQAxIeChpCT0FSRF9MQVlFUl9ESVJFQ1RJT05fQkFDSxAEKvYDChhCb2FyZEVkaXRSZWplY3Rpb25SZWFzb24SKwonQk9BUkRfRURJVF9SRUpFQ1RJT05fUkVBU09OX1VOU1BFQ0lGSUVEEAASKQolQk9BUkRfRURJVF9SRUpFQ1RJT05fUkVBU09OX0ZPUkJJRERFThABEiwKKEJPQVJEX0VESVRfUkVKRUNUSU9OX1JFQVNPTl9JTlZBTElEX0VESVQQAhIwCixCT0FSRF9FRElUX1JFSkVDVElPTl9SRUFTT05fT0JKRUNUX05PVF9GT1VORBADEi8KK0JPQVJEX0VESVRfUkVKRUNUSU9OX1JFQVNPTl9HRU9NRVRSWV9MT0NLRUQQBBIwCixCT0FSRF9FRElUX1JFSkVDVElPTl9SRUFTT05fQ09NTUFORF9JRF9SRVVTRRAFEjAKLEJPQVJEX0VESVRfUkVKRUNUSU9OX1JFQVNPTl9VTlNVUFBPUlRFRF9LSU5EEAYSMwovQk9BUkRfRURJVF9SRUpFQ1RJT05fUkVBU09OX1ZFUlNJT05fVU5BVkFJTEFCTEUQBxIpCiVCT0FSRF9FRElUX1JFSkVDVElPTl9SRUFTT05fVE9PX0xBUkdFEAgSLQopQk9BUkRfRURJVF9SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfSU1BR0UQCTLNAwoQQm9hcmRFZGl0U2VydmljZRJsChFFZGl0Qm9hcmRHZW9tZXRyeRIqLmx1bWluZy5zdHVkaW8udjEuRWRpdEJvYXJkR2VvbWV0cnlSZXF1ZXN0GisubHVtaW5nLnN0dWRpby52MS5FZGl0Qm9hcmRHZW9tZXRyeVJlc3BvbnNlEmwKEUVkaXRPYmplY3RDb250ZW50EioubHVtaW5nLnN0dWRpby52MS5FZGl0T2JqZWN0Q29udGVudFJlcXVlc3QaKy5sdW1pbmcuc3R1ZGlvLnYxLkVkaXRPYmplY3RDb250ZW50UmVzcG9uc2USaQoQQXR0YWNoQm9hcmRJbWFnZRIpLmx1bWluZy5zdHVkaW8udjEuQXR0YWNoQm9hcmRJbWFnZVJlcXVlc3QaKi5sdW1pbmcuc3R1ZGlvLnYxLkF0dGFjaEJvYXJkSW1hZ2VSZXNwb25zZRJyChNHZXRCb2FyZEVkaXRSZWNlaXB0EiwubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZEVkaXRSZWNlaXB0UmVxdWVzdBotLmx1bWluZy5zdHVkaW8udjEuR2V0Qm9hcmRFZGl0UmVjZWlwdFJlc3BvbnNlYgZwcm90bzM", [file_google_protobuf_struct, file_luming_studio_v1_whiteboard_payload, file_luming_studio_v1_whiteboard_scene, file_luming_studio_v1_whiteboard_service]);
var SaveEmbedStateSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_whiteboard_edits, 15);
var BoardTransformKindSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_edits, 0);
var BoardTransformKind = /* @__PURE__ */ tsEnum(BoardTransformKindSchema);
var BoardLayerDirectionSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_edits, 1);
var BoardLayerDirection = /* @__PURE__ */ tsEnum(BoardLayerDirectionSchema);
var BoardEditRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_edits, 2);
var BoardEditRejectionReason = /* @__PURE__ */ tsEnum(BoardEditRejectionReasonSchema);
var BoardEditService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_whiteboard_edits, 0);

// src/entrypoints/http/payload.ts
function toPayloadResult(result) {
  if (result.kind === "unavailable") {
    const reason = result.reason === "notFound" ? ObjectPayloadUnavailableReason.NOT_FOUND : ObjectPayloadUnavailableReason.UNSUPPORTED_KIND;
    return create(ObjectPayloadResultSchema, {
      objectId: result.objectId,
      result: { case: "unavailable", value: { reason } }
    });
  }
  const { objectId, bodyKind, data, payloadVersion } = result.payload;
  const payload = fromJson(ObjectPayloadSchema, {
    [bodyKind]: data,
    payloadVersion: payloadVersion.toString()
  });
  if (payload.body.case !== bodyKind) {
    throw new Error("Stored object payload does not match its Protobuf body");
  }
  return create(ObjectPayloadResultSchema, {
    objectId,
    result: { case: "payload", value: payload }
  });
}

// src/entrypoints/http/scene.ts
var CONNECTOR_PORTS = {
  top: ConnectorPort.TOP,
  bottom: ConnectorPort.BOTTOM,
  left: ConnectorPort.LEFT,
  right: ConnectorPort.RIGHT
};
var CONNECTOR_HEADS = {
  none: ConnectorHead.NONE,
  arrow: ConnectorHead.ARROW,
  circle: ConnectorHead.CIRCLE
};
function toEndpoint(endpoint2) {
  const { point, attachment } = endpoint2;
  if (!attachment) {
    return { point };
  }
  const { objectId, port } = attachment;
  return {
    point,
    attachment: { objectId, port: port ? CONNECTOR_PORTS[port] : ConnectorPort.UNSPECIFIED }
  };
}
function toConnector(detail) {
  const { start, end, bends, relativeBends, labelOffset, startHead, endHead } = detail;
  const axis = relativeBends?.firstAxis === "horizontal" ? BendAxis.HORIZONTAL : BendAxis.VERTICAL;
  return {
    start: toEndpoint(start),
    end: toEndpoint(end),
    bends: [...bends],
    relativeBends: relativeBends ? { firstAxis: axis, offsets: [...relativeBends.offsets] } : void 0,
    labelOffset,
    startHead: startHead ? CONNECTOR_HEADS[startHead] : ConnectorHead.UNSPECIFIED,
    endHead: endHead ? CONNECTOR_HEADS[endHead] : ConnectorHead.UNSPECIFIED
  };
}
function toGeometryDetail(detail) {
  if (!detail) {
    return void 0;
  }
  switch (detail.kind) {
    case "shape":
      return { case: "shape", value: { outline: detail.outline } };
    case "section":
      return { case: "section", value: { transparent: detail.transparent } };
    case "ink":
      return { case: "ink", value: { width: detail.width } };
    case "connector":
      return { case: "connector", value: toConnector(detail) };
  }
}
function toObjectMetadata(object) {
  return create(ObjectMetadataSchema, {
    objectId: object.objectId,
    kind: object.kind,
    label: object.label,
    geometry: object.geometry,
    geometryVersion: object.geometryVersion,
    payloadVersion: object.payloadVersion,
    locked: object.locked,
    parentId: object.parentId,
    groupId: object.groupId,
    appearance: object.appearance,
    geometryDetail: toGeometryDetail(object.detail)
  });
}
function toBoardScene(scene) {
  return create(BoardSceneSchema, {
    boardId: scene.board.boardId,
    title: scene.board.title,
    boardRevision: scene.board.revision,
    access: scene.access,
    objects: scene.objects.map(toObjectMetadata)
  });
}

// src/entrypoints/http/board-edit-receipt.ts
var rejection2 = {
  forbidden: BoardEditRejectionReason.FORBIDDEN,
  invalidEdit: BoardEditRejectionReason.INVALID_EDIT,
  objectNotFound: BoardEditRejectionReason.OBJECT_NOT_FOUND,
  geometryLocked: BoardEditRejectionReason.GEOMETRY_LOCKED,
  commandIdReuse: BoardEditRejectionReason.COMMAND_ID_REUSE,
  unsupportedKind: BoardEditRejectionReason.UNSUPPORTED_KIND,
  versionUnavailable: BoardEditRejectionReason.VERSION_UNAVAILABLE,
  tooLarge: BoardEditRejectionReason.TOO_LARGE,
  invalidImage: BoardEditRejectionReason.INVALID_IMAGE
};
function encodePayload(payload) {
  return toPayloadResult({ kind: "payload", payload });
}
function toBoardEditReceipt({
  boardId,
  commandId,
  outcome
}) {
  if (outcome.kind === "rejected") {
    return {
      boardId,
      commandId,
      outcome: { case: "rejected", value: { reason: rejection2[outcome.reason] } }
    };
  }
  if (outcome.kind === "conflict") {
    return {
      boardId,
      commandId,
      outcome: {
        case: "conflict",
        value: {
          boardRevision: outcome.boardRevision,
          currentObjects: outcome.objects?.map(toObjectMetadata),
          currentPayloads: outcome.payloads?.map(encodePayload)
        }
      }
    };
  }
  const changedPayloads = outcome.payloads.map(encodePayload);
  for (const objectId of outcome.removedPayloadObjectIds ?? []) {
    changedPayloads.push(toPayloadResult({ kind: "unavailable", objectId, reason: "notFound" }));
  }
  return {
    boardId,
    commandId,
    outcome: {
      case: "applied",
      value: {
        boardRevision: outcome.boardRevision,
        changedObjects: outcome.objects.map(toObjectMetadata),
        removedObjectIds: [...outcome.removedObjectIds],
        objectOrder: outcome.order ? [...outcome.order] : [],
        changedPayloads,
        detailsExpired: outcome.detailsExpired
      }
    }
  };
}

// src/entrypoints/http/content-edits.ts
function readSourceRef(source) {
  return {
    ...source.boardId === void 0 ? {} : { boardId: requireId(source.boardId) },
    objectId: requireId(source.objectId),
    ...source.blockId === void 0 ? {} : { blockId: requireId(source.blockId) },
    ...source.itemId === void 0 ? {} : { itemId: requireId(source.itemId) },
    ...source.version === void 0 ? {} : { version: source.version.toString() }
  };
}
function readPlacement(placement) {
  const position = placement?.position;
  switch (position?.case) {
    case "first":
      if (position.value) {
        return { kind: "first" };
      }
      break;
    case "append":
      if (position.value) {
        return { kind: "append" };
      }
      break;
    case "afterItemId":
      return { kind: "after", itemId: requireId(position.value) };
    case void 0:
      break;
  }
  throw new HttpRequestError(400, "A todo placement is required");
}
function readSourceChange(change) {
  switch (change.case) {
    case "sourceRef":
      return readSourceRef(change.value);
    case "clearSource":
      if (change.value) {
        return null;
      }
      throw new HttpRequestError(400, "The todo source clear field must be true");
    case void 0:
      return void 0;
  }
}
function readTodoEdit({ operation }) {
  switch (operation.case) {
    case "rename":
      return { kind: "rename", title: operation.value };
    case "insert": {
      const { item, placement } = operation.value;
      if (!item) {
        throw new HttpRequestError(400, "A todo row is required");
      }
      return {
        kind: "insert",
        item: {
          itemId: requireId(item.itemId),
          text: item.text,
          checked: item.checked,
          sourceRef: item.sourceRef && readSourceRef(item.sourceRef)
        },
        placement: readPlacement(placement)
      };
    }
    case "update": {
      const { itemId, text: text2, checked, sourceChange } = operation.value;
      return {
        kind: "update",
        itemId: requireId(itemId),
        text: text2,
        checked,
        sourceRef: readSourceChange(sourceChange)
      };
    }
    case "deleteItemId":
      return { kind: "delete", itemId: requireId(operation.value) };
    case "move":
      return {
        kind: "move",
        itemId: requireId(operation.value.itemId),
        placement: readPlacement(operation.value.placement)
      };
    case void 0:
      throw new HttpRequestError(400, "A todo operation is required");
  }
}
function contentJson(encode) {
  try {
    const value = encode();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Expected a JSON object");
    }
    return value;
  } catch (error) {
    throw new HttpRequestError(400, "The content cannot be encoded", { cause: error });
  }
}
function readCrop({ crop, naturalSize: naturalSize2 }) {
  if (!crop || !naturalSize2) {
    throw new HttpRequestError(400, "Crop and natural image size are required");
  }
  return {
    crop: { zoom: crop.zoom, x: crop.x, y: crop.y },
    naturalSize: { width: naturalSize2.width, height: naturalSize2.height }
  };
}
function readContentOperation({
  objectId,
  expectedPayloadVersion,
  edit
}) {
  if (expectedPayloadVersion === void 0) {
    throw new HttpRequestError(400, "An expected payload version is required");
  }
  const target2 = { objectId: requireId(objectId), expectedPayloadVersion };
  switch (edit.case) {
    case "document": {
      const data = contentJson(
        () => toJson(DocumentPayloadSchema, edit.value, { alwaysEmitImplicit: true })
      );
      return { ...target2, kind: "document", data };
    }
    case "text": {
      const encoded = contentJson(() => toJson(TextPayloadSchema, edit.value));
      return { ...target2, kind: "text", data: { ...encoded, text: edit.value.text } };
    }
    case "todo":
      return { ...target2, kind: "todo", edits: edit.value.edits.map(readTodoEdit) };
    case "table": {
      const { table, widthChange } = edit.value;
      if (!table) {
        throw new HttpRequestError(400, "A table body is required");
      }
      return {
        ...target2,
        kind: "table",
        data: contentJson(() => toJson(TablePayloadSchema, table)),
        widthChange: widthChange && {
          expectedWidth: widthChange.expectedWidth,
          width: widthChange.width
        }
      };
    }
    case "embedSource": {
      const { title, html, expectedSourceRevision } = edit.value;
      if (expectedSourceRevision === void 0) {
        throw new HttpRequestError(400, "An expected HTML source revision is required");
      }
      return { ...target2, kind: "embedSource", title, html, expectedSourceRevision };
    }
    case "embedState": {
      const { state } = contentJson(() => toJson(SaveEmbedStateSchema, edit.value));
      if (state === void 0) {
        throw new HttpRequestError(400, "An HTML state is required");
      }
      return { ...target2, kind: "embedState", state };
    }
    case "sticker": {
      const { stickerId, fallback } = edit.value;
      if (fallback === void 0) {
        return {
          ...target2,
          kind: "sticker",
          selection: { kind: "icon", id: requireId(stickerId) }
        };
      }
      if (stickerId !== "") {
        throw new HttpRequestError(400, "Choose either a sticker identifier or legacy text");
      }
      return { ...target2, kind: "sticker", selection: { kind: "legacy", fallback } };
    }
    case "crop":
      return { ...target2, kind: "crop", ...readCrop(edit.value) };
    case void 0:
      throw new HttpRequestError(400, "A content operation is required");
  }
}

// src/entrypoints/http/geometry-edits.ts
var transformKinds = /* @__PURE__ */ new Map([
  [BoardTransformKind.RESIZE, "resize"],
  [BoardTransformKind.ROTATE, "rotate"],
  [BoardTransformKind.CONNECT, "connect"]
]);
var layerDirections = /* @__PURE__ */ new Map([
  [BoardLayerDirection.FORWARD, "forward"],
  [BoardLayerDirection.BACKWARD, "backward"],
  [BoardLayerDirection.FRONT, "front"],
  [BoardLayerDirection.BACK, "back"]
]);
var ports = /* @__PURE__ */ new Map([
  [ConnectorPort.TOP, "top"],
  [ConnectorPort.BOTTOM, "bottom"],
  [ConnectorPort.LEFT, "left"],
  [ConnectorPort.RIGHT, "right"]
]);
var heads = /* @__PURE__ */ new Map([
  [ConnectorHead.NONE, "none"],
  [ConnectorHead.ARROW, "arrow"],
  [ConnectorHead.CIRCLE, "circle"]
]);
var bendAxes = /* @__PURE__ */ new Map([
  [BendAxis.HORIZONTAL, "horizontal"],
  [BendAxis.VERTICAL, "vertical"]
]);
function requireField(value, name) {
  if (value === void 0) {
    throw new HttpRequestError(400, name + " is required or is unsupported");
  }
  return value;
}
function readTarget(value) {
  const { objectId, expectedGeometryVersion } = requireField(value, "Edit target");
  return {
    objectId: requireId(objectId),
    expectedGeometryVersion: requireField(expectedGeometryVersion, "Expected geometry version")
  };
}
function readGeometry(value) {
  const { x, y, width, height, rotation } = requireField(value, "Object geometry");
  return { x, y, width, height, rotation };
}
function readPoint({ x, y }) {
  return { x, y };
}
function readEndpoint(value) {
  const { point, attachment } = requireField(value, "Connector endpoint");
  const origin = readPoint(requireField(point, "Connector point"));
  if (!attachment) {
    return { point: origin };
  }
  const objectId = requireId(attachment.objectId);
  const port = attachment.port === ConnectorPort.UNSPECIFIED ? void 0 : requireField(ports.get(attachment.port), "Connector port");
  return { point: origin, attachment: { objectId, port } };
}
function readHead(value) {
  return value === ConnectorHead.UNSPECIFIED ? void 0 : requireField(heads.get(value), "Connector head");
}
function readConnector({
  start,
  end,
  bends,
  relativeBends,
  labelOffset,
  startHead,
  endHead
}) {
  return {
    kind: "connector",
    start: readEndpoint(start),
    end: readEndpoint(end),
    bends: bends.map(readPoint),
    relativeBends: relativeBends && {
      firstAxis: requireField(bendAxes.get(relativeBends.firstAxis), "Connector bend axis"),
      offsets: relativeBends.offsets
    },
    labelOffset: labelOffset && readPoint(labelOffset),
    startHead: readHead(startHead),
    endHead: readHead(endHead)
  };
}
function readDetail(detail) {
  switch (detail.case) {
    case "shape":
      return { kind: detail.case, outline: detail.value.outline };
    case "section":
      return { kind: detail.case, transparent: detail.value.transparent };
    case "ink":
      return { kind: detail.case, width: detail.value.width };
    case "connector":
      return readConnector(detail.value);
    case void 0:
      return void 0;
  }
}
function readAppearance(value) {
  if (!value) {
    return void 0;
  }
  const { fill, stroke, strokeWidth, dashed, hollow } = value;
  return { fill, stroke, strokeWidth, dashed, hollow };
}
function readCreatedObject(value) {
  const {
    objectId,
    kind,
    label,
    geometry,
    geometryVersion,
    payloadVersion,
    locked,
    parentId,
    groupId,
    appearance: appearance2,
    geometryDetail: geometryDetail2
  } = requireField(value, "New object");
  return {
    objectId: requireId(objectId),
    kind,
    label,
    geometry: readGeometry(geometry),
    geometryVersion: geometryVersion ?? 0n,
    payloadVersion,
    locked,
    parentId,
    groupId,
    appearance: readAppearance(appearance2),
    detail: readDetail(geometryDetail2)
  };
}
function readInitialPayload(objectId, value) {
  if (!value) {
    return void 0;
  }
  const bodyKind = requireField(value.body.case, "Initial payload body");
  const converted = toJson(ObjectPayloadSchema, value);
  const data = converted && typeof converted === "object" && !Array.isArray(converted) ? converted[bodyKind] : void 0;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpRequestError(400, "Initial object payload must be a Protobuf message");
  }
  return { objectId, payloadVersion: value.payloadVersion ?? 0n, bodyKind, data };
}
function readCreate(value) {
  const object = readCreatedObject(value.object);
  return {
    kind: "create",
    object,
    payload: readInitialPayload(object.objectId, value.initialPayload)
  };
}
function readTransform(change) {
  const { target: target2, geometry, connector: connector2, ink } = change;
  return {
    target: readTarget(target2),
    geometry: readGeometry(geometry),
    connector: connector2 && readConnector(connector2),
    ink: ink?.points.map(readPoint)
  };
}
function readGeometryOperation({ operation }) {
  switch (operation.case) {
    case "create":
      return readCreate(operation.value);
    case "transform":
      return {
        kind: "transform",
        transform: requireField(transformKinds.get(operation.value.kind), "Transform kind"),
        objects: operation.value.objects.map(readTransform)
      };
    case "changeLock":
      return {
        kind: "lock",
        locked: operation.value.locked,
        targets: operation.value.targets.map(readTarget)
      };
    case "delete":
      return { kind: "delete", targets: operation.value.targets.map(readTarget) };
    case "reorder":
      return {
        kind: "reorder",
        direction: requireField(layerDirections.get(operation.value.direction), "Layer direction"),
        expectedBoardRevision: requireField(
          operation.value.expectedBoardRevision,
          "Expected board revision"
        ),
        targets: operation.value.targets.map(readTarget)
      };
    case "duplicate": {
      const { delta, targets } = operation.value;
      const { dx, dy } = requireField(delta, "Duplicate offset");
      return {
        kind: "duplicate",
        delta: { dx, dy },
        targets: targets.map(({ source, newObjectId }) => ({
          source: readTarget(source),
          newObjectId: requireId(newObjectId)
        }))
      };
    }
    case void 0:
      throw new HttpRequestError(400, "Geometry operation is required");
  }
}

// src/entrypoints/http/image-edits.ts
function readImageOperation({
  objectId,
  displayName,
  content,
  geometry
}) {
  if (!geometry) {
    throw new HttpRequestError(400, "Image geometry is required.");
  }
  const { x, y, width, height, rotation } = geometry;
  return { objectId, displayName, content, geometry: { x, y, width, height, rotation } };
}

// src/entrypoints/http/edit-routes.ts
var { editBoardGeometry, editObjectContent, attachBoardImage, getBoardEditReceipt } = BoardEditService.method;
var boardImageRoutePath = "/" + BoardEditService.typeName + "/" + attachBoardImage.name;
var boardImageRequestLimit = 8 * 1024 * 1024 + 32 * 1024;
function createBoardEditRoutes(application, digest2, observe) {
  function changed(edit) {
    observe?.(edit);
    return toBoardEditReceipt(edit);
  }
  return [
    unaryRoute(editBoardGeometry, (actor, request) => ({
      receipt: changed(
        application.editGeometry(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readGeometryOperation(request),
          signature: "geometry:" + digest2(toBinary(editBoardGeometry.input, request))
        })
      )
    })),
    unaryRoute(editObjectContent, (actor, request) => ({
      receipt: changed(
        application.editContent(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readContentOperation(request),
          signature: "content:" + digest2(toBinary(editObjectContent.input, request))
        })
      )
    })),
    unaryRoute(attachBoardImage, (actor, request) => ({
      receipt: changed(
        application.attachImage(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readImageOperation(request),
          signature: "image:" + digest2(toBinary(attachBoardImage.input, request))
        })
      )
    })),
    unaryRoute(getBoardEditReceipt, (actor, request) => {
      const receipt = application.getEditReceipt(actor, {
        boardId: requireId(request.boardId),
        commandId: requireId(request.commandId)
      });
      return { receipt: receipt && toBoardEditReceipt(receipt) };
    })
  ];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/feedback_service_pb.js
var file_luming_studio_v1_feedback_service = /* @__PURE__ */ fileDesc("CidsdW1pbmcvc3R1ZGlvL3YxL2ZlZWRiYWNrX3NlcnZpY2UucHJvdG8SEGx1bWluZy5zdHVkaW8udjEiJQoNRmVlZGJhY2tQb2ludBIJCgF4GAEgASgBEgkKAXkYAiABKAEicgoTRmVlZGJhY2tPYmplY3RQb2ludBIRCglvYmplY3RfaWQYASABKAkSCQoBdRgCIAEoARIJCgF2GAMgASgBEh0KEGdlb21ldHJ5X3ZlcnNpb24YBCABKARIAIgBAUITChFfZ2VvbWV0cnlfdmVyc2lvbiKXAQoURmVlZGJhY2tBbmNob3JUYXJnZXQSNgoLYm9hcmRfcG9pbnQYASABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrUG9pbnRIABI9CgxvYmplY3RfcG9pbnQYAiABKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrT2JqZWN0UG9pbnRIAEIICgZ0YXJnZXQiegoURmVlZGJhY2tGcm96ZW5PYmplY3QSDAoEa2luZBgBIAEoCRINCgVsYWJlbBgCIAEoCRIJCgF4GAMgASgBEgkKAXkYBCABKAESDQoFd2lkdGgYBSABKAESDgoGaGVpZ2h0GAYgASgBEhAKCHJvdGF0aW9uGAcgASgBIvUBCg5GZWVkYmFja0FuY2hvchI2CgZ0YXJnZXQYASABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrQW5jaG9yVGFyZ2V0Eh0KFXNvdXJjZV9ib2FyZF9yZXZpc2lvbhgCIAEoBBI1Cgxmcm96ZW5fcG9pbnQYAyABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrUG9pbnQSPQoNZnJvemVuX29iamVjdBgEIAEoCzImLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tGcm96ZW5PYmplY3QSFgoOdGFyZ2V0X21pc3NpbmcYBSABKAgiwQEKD0ZlZWRiYWNrTWVzc2FnZRISCgptZXNzYWdlX2lkGAEgASgJEhcKD2F1dGhvcl9hY3Rvcl9pZBgCIAEoCRIaChJhdXRob3JlZF9ieV92aWV3ZXIYAyABKAgSDAoEdGV4dBgEIAEoCRIZChFjcmVhdGVkX2F0X21pbGxpcxgFIAEoBBIZChF1cGRhdGVkX2F0X21pbGxpcxgGIAEoBBIPCgd2ZXJzaW9uGAcgASgEEhAKCGNhbl9lZGl0GAggASgIIqkCCg5GZWVkYmFja1RocmVhZBIRCgl0aHJlYWRfaWQYASABKAkSNgoGc3RhdHVzGAIgASgOMiYubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja1RocmVhZFN0YXR1cxIwCgZhbmNob3IYAyABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrQW5jaG9yEjAKBWZpcnN0GAQgASgLMiEubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja01lc3NhZ2USDwoHdmVyc2lvbhgFIAEoBBIZChF1cGRhdGVkX2F0X21pbGxpcxgGIAEoBBITCgtyZXBseV9jb3VudBgHIAEoDRITCgtjYW5fcmVzb2x2ZRgIIAEoCBISCgpjYW5fZGVsZXRlGAkgASgIIsMBChJMaXN0VGhyZWFkc1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEQoJcGFnZV9zaXplGAIgASgNEhMKBmN1cnNvchgDIAEoCUgAiAEBEjYKBnN0YXR1cxgEIAEoDjImLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tUaHJlYWRTdGF0dXMSHAoPYXV0aG9yX2FjdG9yX2lkGAUgASgJSAGIAQFCCQoHX2N1cnNvckISChBfYXV0aG9yX2FjdG9yX2lkIoUBChNMaXN0VGhyZWFkc1Jlc3BvbnNlEjEKB3RocmVhZHMYASADKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrVGhyZWFkEhgKC25leHRfY3Vyc29yGAIgASgJSACIAQESEQoJY2FuX3dyaXRlGAMgASgIQg4KDF9uZXh0X2N1cnNvciJqChBHZXRUaHJlYWRSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhEKCXRocmVhZF9pZBgCIAEoCRIRCglwYWdlX3NpemUYAyABKA0SEwoGY3Vyc29yGAQgASgJSACIAQFCCQoHX2N1cnNvciK2AQoRR2V0VGhyZWFkUmVzcG9uc2USMAoGdGhyZWFkGAEgASgLMiAubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja1RocmVhZBIyCgdyZXBsaWVzGAIgAygLMiEubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja01lc3NhZ2USGAoLbmV4dF9jdXJzb3IYAyABKAlIAIgBARIRCgljYW5fd3JpdGUYBCABKAhCDgoMX25leHRfY3Vyc29yIlYKDkZlZWRiYWNrQ3JlYXRlEjYKBmFuY2hvchgBIAEoCzImLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tBbmNob3JUYXJnZXQSDAoEdGV4dBgCIAEoCSIwCg1GZWVkYmFja1JlcGx5EhEKCXRocmVhZF9pZBgBIAEoCRIMCgR0ZXh0GAIgASgJIocBCgxGZWVkYmFja0VkaXQSEQoJdGhyZWFkX2lkGAEgASgJEhIKCm1lc3NhZ2VfaWQYAiABKAkSJQoYZXhwZWN0ZWRfbWVzc2FnZV92ZXJzaW9uGAMgASgESACIAQESDAoEdGV4dBgEIAEoCUIbChlfZXhwZWN0ZWRfbWVzc2FnZV92ZXJzaW9uImsKFEZlZWRiYWNrVGhyZWFkQ2hhbmdlEhEKCXRocmVhZF9pZBgBIAEoCRIkChdleHBlY3RlZF90aHJlYWRfdmVyc2lvbhgCIAEoBEgAiAEBQhoKGF9leHBlY3RlZF90aHJlYWRfdmVyc2lvbiKOAwoUQXBwbHlGZWVkYmFja1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRIyCgZjcmVhdGUYAyABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrQ3JlYXRlSAASMAoFcmVwbHkYBCABKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrUmVwbHlIABIuCgRlZGl0GAUgASgLMh4ubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja0VkaXRIABI5CgdyZXNvbHZlGAYgASgLMiYubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja1RocmVhZENoYW5nZUgAEjgKBnJlb3BlbhgHIAEoCzImLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tUaHJlYWRDaGFuZ2VIABI4CgZkZWxldGUYCCABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrVGhyZWFkQ2hhbmdlSABCCwoJb3BlcmF0aW9uIksKFUFwcGx5RmVlZGJhY2tSZXNwb25zZRIyCgdyZWNlaXB0GAEgASgLMiEubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja1JlY2VpcHQipwEKD0ZlZWRiYWNrQXBwbGllZBIRCgl0aHJlYWRfaWQYASABKAkSFgoOdGhyZWFkX3ZlcnNpb24YAiABKAQSFwoKbWVzc2FnZV9pZBgDIAEoCUgAiAEBEhwKD21lc3NhZ2VfdmVyc2lvbhgEIAEoBEgBiAEBEg8KB2RlbGV0ZWQYBSABKAhCDQoLX21lc3NhZ2VfaWRCEgoQX21lc3NhZ2VfdmVyc2lvbiJ/ChBGZWVkYmFja1JlamVjdGVkEjkKBnJlYXNvbhgBIAEoDjIpLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tSZWplY3Rpb25SZWFzb24SHAoPY3VycmVudF92ZXJzaW9uGAIgASgESACIAQFCEgoQX2N1cnJlbnRfdmVyc2lvbiKwAQoPRmVlZGJhY2tSZWNlaXB0EhAKCGJvYXJkX2lkGAEgASgJEhIKCmNvbW1hbmRfaWQYAiABKAkSNAoHYXBwbGllZBgDIAEoCzIhLmx1bWluZy5zdHVkaW8udjEuRmVlZGJhY2tBcHBsaWVkSAASNgoIcmVqZWN0ZWQYBCABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrUmVqZWN0ZWRIAEIJCgdvdXRjb21lIkEKGUdldEZlZWRiYWNrUmVjZWlwdFJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCSIwChpGZWVkYmFja1JlY2VpcHROb3RSZWNvcmRlZBISCgpjb21tYW5kX2lkGAEgASgJIqIBChpHZXRGZWVkYmFja1JlY2VpcHRSZXNwb25zZRI0CgdyZWNlaXB0GAEgASgLMiEubHVtaW5nLnN0dWRpby52MS5GZWVkYmFja1JlY2VpcHRIABJECgxub3RfcmVjb3JkZWQYAiABKAsyLC5sdW1pbmcuc3R1ZGlvLnYxLkZlZWRiYWNrUmVjZWlwdE5vdFJlY29yZGVkSABCCAoGcmVzdWx0KoQBChRGZWVkYmFja1RocmVhZFN0YXR1cxImCiJGRUVEQkFDS19USFJFQURfU1RBVFVTX1VOU1BFQ0lGSUVEEAASHwobRkVFREJBQ0tfVEhSRUFEX1NUQVRVU19PUEVOEAESIwofRkVFREJBQ0tfVEhSRUFEX1NUQVRVU19SRVNPTFZFRBACKv0CChdGZWVkYmFja1JlamVjdGlvblJlYXNvbhIpCiVGRUVEQkFDS19SRUpFQ1RJT05fUkVBU09OX1VOU1BFQ0lGSUVEEAASKgomRkVFREJBQ0tfUkVKRUNUSU9OX1JFQVNPTl9JTlZBTElEX1RFWFQQARIsCihGRUVEQkFDS19SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfQU5DSE9SEAISLAooRkVFREJBQ0tfUkVKRUNUSU9OX1JFQVNPTl9UQVJHRVRfQ0hBTkdFRBADEicKI0ZFRURCQUNLX1JFSkVDVElPTl9SRUFTT05fTk9UX0ZPVU5EEAQSJwojRkVFREJBQ0tfUkVKRUNUSU9OX1JFQVNPTl9GT1JCSURERU4QBRItCilGRUVEQkFDS19SRUpFQ1RJT05fUkVBU09OX1ZFUlNJT05fQ0hBTkdFRBAGEi4KKkZFRURCQUNLX1JFSkVDVElPTl9SRUFTT05fQ09NTUFORF9JRF9SRVVTRRAHMpYDCg9GZWVkYmFja1NlcnZpY2USWgoLTGlzdFRocmVhZHMSJC5sdW1pbmcuc3R1ZGlvLnYxLkxpc3RUaHJlYWRzUmVxdWVzdBolLmx1bWluZy5zdHVkaW8udjEuTGlzdFRocmVhZHNSZXNwb25zZRJUCglHZXRUaHJlYWQSIi5sdW1pbmcuc3R1ZGlvLnYxLkdldFRocmVhZFJlcXVlc3QaIy5sdW1pbmcuc3R1ZGlvLnYxLkdldFRocmVhZFJlc3BvbnNlEmAKDUFwcGx5RmVlZGJhY2sSJi5sdW1pbmcuc3R1ZGlvLnYxLkFwcGx5RmVlZGJhY2tSZXF1ZXN0GicubHVtaW5nLnN0dWRpby52MS5BcHBseUZlZWRiYWNrUmVzcG9uc2USbwoSR2V0RmVlZGJhY2tSZWNlaXB0EisubHVtaW5nLnN0dWRpby52MS5HZXRGZWVkYmFja1JlY2VpcHRSZXF1ZXN0GiwubHVtaW5nLnN0dWRpby52MS5HZXRGZWVkYmFja1JlY2VpcHRSZXNwb25zZWIGcHJvdG8z");
var FeedbackThreadStatusSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_feedback_service, 0);
var FeedbackThreadStatus = /* @__PURE__ */ tsEnum(FeedbackThreadStatusSchema);
var FeedbackRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_feedback_service, 1);
var FeedbackRejectionReason = /* @__PURE__ */ tsEnum(FeedbackRejectionReasonSchema);
var FeedbackService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_feedback_service, 0);

// src/entrypoints/http/feedback-routes.ts
var rejections = {
  invalidText: FeedbackRejectionReason.INVALID_TEXT,
  invalidAnchor: FeedbackRejectionReason.INVALID_ANCHOR,
  targetChanged: FeedbackRejectionReason.TARGET_CHANGED,
  notFound: FeedbackRejectionReason.NOT_FOUND,
  forbidden: FeedbackRejectionReason.FORBIDDEN,
  versionChanged: FeedbackRejectionReason.VERSION_CHANGED,
  commandIdReuse: FeedbackRejectionReason.COMMAND_ID_REUSE
};
function requireVersion(version) {
  if (version === void 0) {
    throw new HttpRequestError(400, "Feedback expected version is required.");
  }
  return version;
}
function readTarget2(anchor) {
  const target2 = anchor?.target;
  switch (target2?.case) {
    case "boardPoint":
      return {
        kind: "board",
        point: { x: target2.value.x, y: target2.value.y }
      };
    case "objectPoint": {
      const { objectId, u, v, geometryVersion } = target2.value;
      return {
        kind: "object",
        objectId: requireId(objectId),
        u,
        v,
        geometryVersion: requireVersion(geometryVersion)
      };
    }
    case void 0:
      throw new HttpRequestError(400, "Feedback anchor target is required.");
  }
}
function readOperation(operation) {
  switch (operation.case) {
    case "create":
      return {
        kind: "create",
        anchor: readTarget2(operation.value.anchor),
        text: operation.value.text
      };
    case "reply":
      return {
        kind: "reply",
        threadId: requireId(operation.value.threadId),
        text: operation.value.text
      };
    case "edit":
      return {
        kind: "edit",
        threadId: requireId(operation.value.threadId),
        messageId: requireId(operation.value.messageId),
        expectedMessageVersion: requireVersion(operation.value.expectedMessageVersion),
        text: operation.value.text
      };
    case "resolve":
    case "reopen":
    case "delete":
      return {
        kind: operation.case,
        threadId: requireId(operation.value.threadId),
        expectedThreadVersion: requireVersion(operation.value.expectedThreadVersion)
      };
    case void 0:
      throw new HttpRequestError(400, "Feedback operation is required.");
  }
}
function readStatus(status) {
  switch (status) {
    case FeedbackThreadStatus.UNSPECIFIED:
      return void 0;
    case FeedbackThreadStatus.OPEN:
      return "open";
    case FeedbackThreadStatus.RESOLVED:
      return "resolved";
    default:
      throw new HttpRequestError(400, "Feedback status filter is invalid.");
  }
}
function writeAnchor(anchor) {
  const { target: target2, ...source } = anchor;
  if (target2.kind === "board") {
    return {
      ...source,
      target: { target: { case: "boardPoint", value: target2.point } }
    };
  }
  const { objectId, u, v, geometryVersion } = target2;
  return {
    ...source,
    target: { target: { case: "objectPoint", value: { objectId, u, v, geometryVersion } } }
  };
}
function writeThread(thread) {
  return {
    ...thread,
    status: thread.status === "open" ? FeedbackThreadStatus.OPEN : FeedbackThreadStatus.RESOLVED,
    anchor: writeAnchor(thread.anchor)
  };
}
function writeReceipt(receipt) {
  const { boardId, commandId, outcome } = receipt;
  if (outcome.kind === "applied") {
    const { threadId, threadVersion, messageId, messageVersion, deleted } = outcome;
    return {
      boardId,
      commandId,
      outcome: {
        case: "applied",
        value: { threadId, threadVersion, messageId, messageVersion, deleted }
      }
    };
  }
  return {
    boardId,
    commandId,
    outcome: {
      case: "rejected",
      value: { reason: rejections[outcome.reason], currentVersion: outcome.currentVersion }
    }
  };
}
function createFeedbackRoutes(application) {
  const { listThreads: listThreads2, getThread: getThread2, applyFeedback: applyFeedback2, getFeedbackReceipt } = FeedbackService.method;
  return [
    unaryRoute(listThreads2, (actor, request) => {
      const { boardId, pageSize, cursor, status, authorActorId } = request;
      const page = application.listThreads(actor, requireId(boardId), {
        pageSize,
        cursor,
        status: readStatus(status),
        authorActorId
      });
      return { ...page, threads: page.threads.map(writeThread) };
    }),
    unaryRoute(getThread2, (actor, request) => {
      const { boardId, threadId, pageSize, cursor } = request;
      const page = application.getThread(actor, requireId(boardId), requireId(threadId), {
        pageSize,
        cursor
      });
      return { ...page, thread: writeThread(page.thread), replies: [...page.replies] };
    }),
    unaryRoute(applyFeedback2, (actor, request) => {
      const receipt = application.applyFeedback(actor, {
        boardId: requireId(request.boardId),
        commandId: requireId(request.commandId),
        operation: readOperation(request.operation)
      });
      return { receipt: writeReceipt(receipt) };
    }),
    unaryRoute(
      getFeedbackReceipt,
      (actor, request) => {
        const commandId = requireId(request.commandId);
        const receipt = application.getReceipt(actor, requireId(request.boardId), commandId);
        if (!receipt) {
          return { result: { case: "notRecorded", value: { commandId } } };
        }
        return { result: { case: "receipt", value: writeReceipt(receipt) } };
      }
    )
  ];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/whiteboard_history_pb.js
var file_luming_studio_v1_whiteboard_history = /* @__PURE__ */ fileDesc("CilsdW1pbmcvc3R1ZGlvL3YxL3doaXRlYm9hcmRfaGlzdG9yeS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSJtChhMaXN0Qm9hcmRWZXJzaW9uc1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSHAoPYmVmb3JlX3JldmlzaW9uGAIgASgESACIAQESDQoFbGltaXQYAyABKA1CEgoQX2JlZm9yZV9yZXZpc2lvbiLEAQoZTGlzdEJvYXJkVmVyc2lvbnNSZXNwb25zZRIdChBjdXJyZW50X3JldmlzaW9uGAEgASgESACIAQESNwoIdmVyc2lvbnMYAiADKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkVmVyc2lvblN1bW1hcnkSIQoUbmV4dF9iZWZvcmVfcmV2aXNpb24YAyABKARIAYgBAUITChFfY3VycmVudF9yZXZpc2lvbkIXChVfbmV4dF9iZWZvcmVfcmV2aXNpb24ijgIKE0JvYXJkVmVyc2lvblN1bW1hcnkSFQoIcmV2aXNpb24YASABKARIAIgBARINCgV0aXRsZRgCIAEoCRIcCg9zYXZlZF9hdF9taWxsaXMYAyABKARIAYgBARIQCghhY3Rvcl9pZBgEIAEoCRIwCgRraW5kGAUgASgOMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZFZlcnNpb25LaW5kEhwKFGNoYW5nZWRfb2JqZWN0X2NvdW50GAYgASgNEhwKD3NvdXJjZV9yZXZpc2lvbhgHIAEoBEgCiAEBQgsKCV9yZXZpc2lvbkISChBfc2F2ZWRfYXRfbWlsbGlzQhIKEF9zb3VyY2VfcmV2aXNpb24iUwobR2V0Qm9hcmRWZXJzaW9uU2NlbmVSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhUKCHJldmlzaW9uGAIgASgESACIAQFCCwoJX3JldmlzaW9uIksKHEdldEJvYXJkVmVyc2lvblNjZW5lUmVzcG9uc2USKwoFc2NlbmUYASABKAsyHC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU2NlbmUiagoeR2V0Qm9hcmRWZXJzaW9uUGF5bG9hZHNSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhUKCHJldmlzaW9uGAIgASgESACIAQESEgoKb2JqZWN0X2lkcxgDIAMoCUILCglfcmV2aXNpb24ipAEKH0dldEJvYXJkVmVyc2lvblBheWxvYWRzUmVzcG9uc2USEAoIYm9hcmRfaWQYASABKAkSFQoIcmV2aXNpb24YAiABKARIAIgBARI2CgdyZXN1bHRzGAMgAygLMiUubHVtaW5nLnN0dWRpby52MS5PYmplY3RQYXlsb2FkUmVzdWx0EhMKC3VuYXZhaWxhYmxlGAQgASgIQgsKCV9yZXZpc2lvbiKnAgoaUmVzdG9yZUJvYXJkVmVyc2lvblJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRIVCghyZXZpc2lvbhgDIAEoBEgBiAEBEiYKGWV4cGVjdGVkX2N1cnJlbnRfcmV2aXNpb24YBCABKARIAogBARIzCgV3aG9sZRgFIAEoCzIiLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0V2hvbGVCb2FyZEgAEjsKCXNlbGVjdGlvbhgGIAEoCzImLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0Qm9hcmRTZWxlY3Rpb25IAEIHCgVzY29wZUILCglfcmV2aXNpb25CHAoaX2V4cGVjdGVkX2N1cnJlbnRfcmV2aXNpb24iUgobUmVzdG9yZUJvYXJkVmVyc2lvblJlc3BvbnNlEjMKB3JlY2VpcHQYASABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdFJlY2VpcHQigQIKGUV4cG9ydEJvYXJkVmVyc2lvblJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSFQoIcmV2aXNpb24YAiABKARIAYgBARIzCgV3aG9sZRgDIAEoCzIiLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0V2hvbGVCb2FyZEgAEjsKCXNlbGVjdGlvbhgEIAEoCzImLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0Qm9hcmRTZWxlY3Rpb25IABIzCgZmb3JtYXQYBSABKA4yIy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRXhwb3J0Rm9ybWF0QgcKBXNjb3BlQgsKCV9yZXZpc2lvbiKrAQoaRXhwb3J0Qm9hcmRWZXJzaW9uUmVzcG9uc2USMQoEZmlsZRgBIAEoCzIhLmx1bWluZy5zdHVkaW8udjEuRXhwb3J0Qm9hcmRGaWxlSAASOQoIcmVqZWN0ZWQYAiABKAsyJS5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkUmVqZWN0ZWRIABIVCgt1bmF2YWlsYWJsZRgDIAEoCEgAQggKBnJlc3VsdCrWAQoQQm9hcmRWZXJzaW9uS2luZBIiCh5CT0FSRF9WRVJTSU9OX0tJTkRfVU5TUEVDSUZJRUQQABIfChtCT0FSRF9WRVJTSU9OX0tJTkRfQkFTRUxJTkUQARIfChtCT0FSRF9WRVJTSU9OX0tJTkRfR0VPTUVUUlkQAhIeChpCT0FSRF9WRVJTSU9OX0tJTkRfQ09OVEVOVBADEhwKGEJPQVJEX1ZFUlNJT05fS0lORF9JTUFHRRAEEh4KGkJPQVJEX1ZFUlNJT05fS0lORF9SRVNUT1JFEAUy3wQKE0JvYXJkSGlzdG9yeVNlcnZpY2USbAoRTGlzdEJvYXJkVmVyc2lvbnMSKi5sdW1pbmcuc3R1ZGlvLnYxLkxpc3RCb2FyZFZlcnNpb25zUmVxdWVzdBorLmx1bWluZy5zdHVkaW8udjEuTGlzdEJvYXJkVmVyc2lvbnNSZXNwb25zZRJ1ChRHZXRCb2FyZFZlcnNpb25TY2VuZRItLmx1bWluZy5zdHVkaW8udjEuR2V0Qm9hcmRWZXJzaW9uU2NlbmVSZXF1ZXN0Gi4ubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFZlcnNpb25TY2VuZVJlc3BvbnNlEn4KF0dldEJvYXJkVmVyc2lvblBheWxvYWRzEjAubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFZlcnNpb25QYXlsb2Fkc1JlcXVlc3QaMS5sdW1pbmcuc3R1ZGlvLnYxLkdldEJvYXJkVmVyc2lvblBheWxvYWRzUmVzcG9uc2UScgoTUmVzdG9yZUJvYXJkVmVyc2lvbhIsLmx1bWluZy5zdHVkaW8udjEuUmVzdG9yZUJvYXJkVmVyc2lvblJlcXVlc3QaLS5sdW1pbmcuc3R1ZGlvLnYxLlJlc3RvcmVCb2FyZFZlcnNpb25SZXNwb25zZRJvChJFeHBvcnRCb2FyZFZlcnNpb24SKy5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkVmVyc2lvblJlcXVlc3QaLC5sdW1pbmcuc3R1ZGlvLnYxLkV4cG9ydEJvYXJkVmVyc2lvblJlc3BvbnNlYgZwcm90bzM", [file_luming_studio_v1_whiteboard_edits, file_luming_studio_v1_whiteboard_scene, file_luming_studio_v1_whiteboard_service]);
var BoardVersionKindSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_whiteboard_history, 0);
var BoardVersionKind = /* @__PURE__ */ tsEnum(BoardVersionKindSchema);
var BoardHistoryService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_whiteboard_history, 0);

// src/entrypoints/http/export-route.ts
var rejectionByReason = {
  invalidSelection: BoardExportRejectionReason.INVALID_SELECTION,
  unsupported: BoardExportRejectionReason.UNSUPPORTED,
  assetUnavailable: BoardExportRejectionReason.ASSET_UNAVAILABLE,
  tooLarge: BoardExportRejectionReason.TOO_LARGE
};
function toExportFormat(format) {
  if (format === BoardExportFormat.JSON) {
    return "json";
  }
  if (format === BoardExportFormat.SVG) {
    return "svg";
  }
  throw new HttpRequestError(400, "A supported board export format is required");
}
function toExportScope(scope2) {
  switch (scope2.case) {
    case "whole":
      return { kind: "whole" };
    case "selection":
      return { kind: "selection", objectIds: scope2.value.objectIds };
    case void 0:
      throw new HttpRequestError(400, "A board export scope is required");
  }
}
function toExportCommand(request) {
  if (request.expectedRevision === void 0) {
    throw new HttpRequestError(400, "A saved board revision is required");
  }
  return {
    boardId: requireId(request.boardId),
    expectedRevision: request.expectedRevision,
    scope: toExportScope(request.scope),
    format: toExportFormat(request.format)
  };
}
function toExportResponse(result) {
  switch (result.kind) {
    case "file": {
      const { filename, mimeType, revision, content } = result;
      return { result: { case: "file", value: { filename, mimeType, revision, content } } };
    }
    case "stale":
      return { result: { case: "stale", value: { revision: result.revision } } };
    case "rejected":
      return {
        result: { case: "rejected", value: { reason: rejectionByReason[result.reason] } }
      };
  }
}
function createExportRoute(application) {
  return unaryRoute(
    WhiteboardService.method.exportBoard,
    (actor, request) => toExportResponse(application.exportBoard(actor, toExportCommand(request)))
  );
}

// src/entrypoints/http/history-routes.ts
var versionKind = {
  baseline: BoardVersionKind.BASELINE,
  geometry: BoardVersionKind.GEOMETRY,
  content: BoardVersionKind.CONTENT,
  image: BoardVersionKind.IMAGE,
  restore: BoardVersionKind.RESTORE
};
var maxPayloadIds = 500;
function requireRevision(revision) {
  if (revision === void 0) {
    throw new HttpRequestError(400, "A saved board revision is required");
  }
  return revision;
}
function requirePayloadIds(ids) {
  if (ids.length > maxPayloadIds) {
    throw new HttpRequestError(400, "Too many historical object payloads requested");
  }
  return ids.map(requireId);
}
function toVersionSummary(version) {
  const { kind, savedAtMillis, ...summary } = version;
  return {
    ...summary,
    kind: versionKind[kind],
    savedAtMillis: savedAtMillis === void 0 ? void 0 : BigInt(savedAtMillis)
  };
}
function toRestoreCommand(request) {
  return {
    boardId: requireId(request.boardId),
    commandId: requireId(request.commandId),
    revision: requireRevision(request.revision),
    expectedCurrentRevision: requireRevision(request.expectedCurrentRevision),
    scope: toExportScope(request.scope)
  };
}
function toVersionExport(result) {
  if (result.kind !== "unavailable") {
    const { result: encoded } = toExportResponse(result);
    if (encoded?.case === "file" || encoded?.case === "rejected") {
      return { result: encoded };
    }
  }
  return { result: { case: "unavailable", value: true } };
}
function createBoardHistoryRoutes(application, digest2, observe) {
  const {
    listBoardVersions,
    getBoardVersionScene,
    getBoardVersionPayloads,
    restoreBoardVersion,
    exportBoardVersion
  } = BoardHistoryService.method;
  return [
    unaryRoute(listBoardVersions, (actor, request) => {
      const result = application.listVersions(
        actor,
        requireId(request.boardId),
        request.beforeRevision,
        request.limit
      );
      return { ...result, versions: result.versions.map(toVersionSummary) };
    }),
    unaryRoute(getBoardVersionScene, (actor, request) => {
      const scene = application.getVersionScene(
        actor,
        requireId(request.boardId),
        requireRevision(request.revision)
      );
      return { scene: scene && toBoardScene(scene) };
    }),
    unaryRoute(getBoardVersionPayloads, (actor, request) => {
      const boardId = requireId(request.boardId);
      const revision = requireRevision(request.revision);
      const results = application.getVersionPayloads(
        actor,
        boardId,
        revision,
        requirePayloadIds(request.objectIds)
      );
      return {
        boardId,
        revision,
        unavailable: results === void 0,
        results: results?.map(toPayloadResult)
      };
    }),
    unaryRoute(restoreBoardVersion, (actor, request) => {
      const command = toRestoreCommand(request);
      const signature = "restore:" + digest2(toBinary(restoreBoardVersion.input, request));
      const receipt = application.restoreVersion(actor, command, signature);
      observe?.(receipt);
      return { receipt: toBoardEditReceipt(receipt) };
    }),
    unaryRoute(
      exportBoardVersion,
      (actor, request) => toVersionExport(
        application.exportVersion(actor, {
          boardId: requireId(request.boardId),
          expectedRevision: requireRevision(request.revision),
          scope: toExportScope(request.scope),
          format: toExportFormat(request.format)
        })
      )
    )
  ];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/board_room_service_pb.js
var file_luming_studio_v1_board_room_service = /* @__PURE__ */ fileDesc("CilsdW1pbmcvc3R1ZGlvL3YxL2JvYXJkX3Jvb21fc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSInChNHZXRCb2FyZFJvb21SZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJIkcKFEdldEJvYXJkUm9vbVJlc3BvbnNlEi8KBWV2ZW50GAEgASgLMiAubHVtaW5nLnN0dWRpby52MS5Cb2FyZFJvb21FdmVudCJkChFCb2FyZFJvb21WaWV3cG9ydBIQCghjZW50ZXJfeBgBIAEoARIQCghjZW50ZXJfeRgCIAEoARIMCgR6b29tGAMgASgBEg0KBXdpZHRoGAQgASgBEg4KBmhlaWdodBgFIAEoASI8ChdCb2FyZFJvb21QYXJ0aWNpcGFudEtleRIQCghhY3Rvcl9pZBgBIAEoCRIPCgd2aWV3X2lkGAIgASgJIsECChRCb2FyZFJvb21QYXJ0aWNpcGFudBI2CgNrZXkYASABKAsyKS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVBhcnRpY2lwYW50S2V5EhQKDGRpc3BsYXlfbmFtZRgCIAEoCRIMCgRyb2xlGAMgASgJEhUKCHNlcXVlbmNlGAQgASgESACIAQESHwoSZXhwaXJlc19hdF91bml4X21zGAUgASgESAGIAQESJwoGY3Vyc29yGAYgASgLMhcubHVtaW5nLnN0dWRpby52MS5Qb2ludBI1Cgh2aWV3cG9ydBgHIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tVmlld3BvcnQSEQoJZm9sbG93aW5nGAggASgIQgsKCV9zZXF1ZW5jZUIVChNfZXhwaXJlc19hdF91bml4X21zItYBChpVcGRhdGVCb2FyZFByZXNlbmNlUmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRIPCgd2aWV3X2lkGAIgASgJEhUKCHNlcXVlbmNlGAMgASgESACIAQESJwoGY3Vyc29yGAQgASgLMhcubHVtaW5nLnN0dWRpby52MS5Qb2ludBI1Cgh2aWV3cG9ydBgFIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tVmlld3BvcnQSEQoJZm9sbG93aW5nGAYgASgIQgsKCV9zZXF1ZW5jZSIvChtVcGRhdGVCb2FyZFByZXNlbmNlUmVzcG9uc2USEAoIYWNjZXB0ZWQYASABKAgiYgoZTGVhdmVCb2FyZFByZXNlbmNlUmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRIPCgd2aWV3X2lkGAIgASgJEhUKCHNlcXVlbmNlGAMgASgESACIAQFCCwoJX3NlcXVlbmNlIi4KGkxlYXZlQm9hcmRQcmVzZW5jZVJlc3BvbnNlEhAKCGFjY2VwdGVkGAEgASgIItYBChFCb2FyZFJvb21TbmFwc2hvdBIQCghhY3Rvcl9pZBgBIAEoCRIQCghjYW5fZWRpdBgCIAEoCBIbCg5ib2FyZF9yZXZpc2lvbhgDIAEoBEgAiAEBEjwKDHBhcnRpY2lwYW50cxgEIAMoCzImLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tUGFydGljaXBhbnQSLwoFdGltZXIYBSABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVRpbWVyQhEKD19ib2FyZF9yZXZpc2lvbiKNAQoVQm9hcmRSb29tUGFydGljaXBhbnRzEjcKB3Vwc2VydHMYASADKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVBhcnRpY2lwYW50EjsKCHJlbW92YWxzGAIgAygLMikubHVtaW5nLnN0dWRpby52MS5Cb2FyZFJvb21QYXJ0aWNpcGFudEtleSLTAQoXQm9hcmRSb29tQ29udGVudENoYW5nZWQSGwoOYm9hcmRfcmV2aXNpb24YASABKARIAIgBARIaChJjaGFuZ2VkX29iamVjdF9pZHMYAiADKAkSGgoScmVtb3ZlZF9vYmplY3RfaWRzGAMgAygJEhUKDXJlZnJlc2hfc2NlbmUYBCABKAgSOQoPY2hhbmdlZF9vYmplY3RzGAUgAygLMiAubHVtaW5nLnN0dWRpby52MS5PYmplY3RNZXRhZGF0YUIRCg9fYm9hcmRfcmV2aXNpb24iFQoTQm9hcmRSb29tQWNjZXNzTG9zdCLWAwoOQm9hcmRSb29tRXZlbnQSEAoIYm9hcmRfaWQYASABKAkSGAoQcm9vbV9pbnN0YW5jZV9pZBgCIAEoCRIVCghzZXF1ZW5jZRgDIAEoBEgBiAEBEiAKE3NlcnZlcl90aW1lX3VuaXhfbXMYBCABKARIAogBARI3CghzbmFwc2hvdBgFIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tU25hcHNob3RIABI/CgxwYXJ0aWNpcGFudHMYBiABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVBhcnRpY2lwYW50c0gAEjEKBXRpbWVyGAcgASgLMiAubHVtaW5nLnN0dWRpby52MS5Cb2FyZFJvb21UaW1lckgAEkQKD2NvbnRlbnRfY2hhbmdlZBgIIAEoCzIpLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tQ29udGVudENoYW5nZWRIABI8CgthY2Nlc3NfbG9zdBgJIAEoCzIlLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tQWNjZXNzTG9zdEgAQgkKB3BheWxvYWRCCwoJX3NlcXVlbmNlQhYKFF9zZXJ2ZXJfdGltZV91bml4X21zIscBCg5Cb2FyZFJvb21UaW1lchIUCgd2ZXJzaW9uGAEgASgESACIAQESNAoFcGhhc2UYAiABKA4yJS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVRpbWVyUGhhc2USEwoLZHVyYXRpb25fbXMYAyABKA0SHQoQZGVhZGxpbmVfdW5peF9tcxgEIAEoBEgBiAEBEhQKDHJlbWFpbmluZ19tcxgFIAEoDUIKCghfdmVyc2lvbkITChFfZGVhZGxpbmVfdW5peF9tcyISChBCb2FyZFRpbWVyQWN0aW9uIosDChdDaGFuZ2VCb2FyZFRpbWVyUmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJEh0KEGV4cGVjdGVkX3ZlcnNpb24YAyABKARIAYgBARIzCgVzdGFydBgEIAEoCzIiLmx1bWluZy5zdHVkaW8udjEuQm9hcmRUaW1lckFjdGlvbkgAEjMKBXBhdXNlGAUgASgLMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZFRpbWVyQWN0aW9uSAASNAoGcmVzdW1lGAYgASgLMiIubHVtaW5nLnN0dWRpby52MS5Cb2FyZFRpbWVyQWN0aW9uSAASMwoFcmVzZXQYByABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkVGltZXJBY3Rpb25IABIZCg9zZXRfZHVyYXRpb25fbXMYCCABKA1IABIcChJhZGp1c3RfZHVyYXRpb25fbXMYCSABKBFIAEIICgZhY3Rpb25CEwoRX2V4cGVjdGVkX3ZlcnNpb24iRAoRQm9hcmRUaW1lckFwcGxpZWQSLwoFdGltZXIYASABKAsyIC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUm9vbVRpbWVyIkUKEkJvYXJkVGltZXJDb25mbGljdBIvCgV0aW1lchgBIAEoCzIgLmx1bWluZy5zdHVkaW8udjEuQm9hcmRSb29tVGltZXIiSwoSQm9hcmRUaW1lclJlamVjdGVkEjUKBnJlYXNvbhgBIAEoDjIlLmx1bWluZy5zdHVkaW8udjEuQm9hcmRUaW1lclJlamVjdGlvbiLwAQoRQm9hcmRUaW1lclJlY2VpcHQSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRI2CgdhcHBsaWVkGAMgASgLMiMubHVtaW5nLnN0dWRpby52MS5Cb2FyZFRpbWVyQXBwbGllZEgAEjgKCGNvbmZsaWN0GAQgASgLMiQubHVtaW5nLnN0dWRpby52MS5Cb2FyZFRpbWVyQ29uZmxpY3RIABI4CghyZWplY3RlZBgFIAEoCzIkLmx1bWluZy5zdHVkaW8udjEuQm9hcmRUaW1lclJlamVjdGVkSABCCQoHb3V0Y29tZSKKAQoYQ2hhbmdlQm9hcmRUaW1lclJlc3BvbnNlEjQKB3JlY2VpcHQYASABKAsyIy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkVGltZXJSZWNlaXB0EiAKE3NlcnZlcl90aW1lX3VuaXhfbXMYAiABKARIAIgBAUIWChRfc2VydmVyX3RpbWVfdW5peF9tcyJDChtHZXRCb2FyZFRpbWVyUmVjZWlwdFJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCSKOAQocR2V0Qm9hcmRUaW1lclJlY2VpcHRSZXNwb25zZRI0CgdyZWNlaXB0GAEgASgLMiMubHVtaW5nLnN0dWRpby52MS5Cb2FyZFRpbWVyUmVjZWlwdBIgChNzZXJ2ZXJfdGltZV91bml4X21zGAIgASgESACIAQFCFgoUX3NlcnZlcl90aW1lX3VuaXhfbXMqxwEKE0JvYXJkUm9vbVRpbWVyUGhhc2USJgoiQk9BUkRfUk9PTV9USU1FUl9QSEFTRV9VTlNQRUNJRklFRBAAEh8KG0JPQVJEX1JPT01fVElNRVJfUEhBU0VfSURMRRABEiIKHkJPQVJEX1JPT01fVElNRVJfUEhBU0VfUlVOTklORxACEiEKHUJPQVJEX1JPT01fVElNRVJfUEhBU0VfUEFVU0VEEAMSIAocQk9BUkRfUk9PTV9USU1FUl9QSEFTRV9FTkRFRBAEKrcBChNCb2FyZFRpbWVyUmVqZWN0aW9uEiUKIUJPQVJEX1RJTUVSX1JFSkVDVElPTl9VTlNQRUNJRklFRBAAEiMKH0JPQVJEX1RJTUVSX1JFSkVDVElPTl9GT1JCSURERU4QARIoCiRCT0FSRF9USU1FUl9SRUpFQ1RJT05fSU5WQUxJRF9BQ1RJT04QAhIqCiZCT0FSRF9USU1FUl9SRUpFQ1RJT05fQ09NTUFORF9JRF9SRVVTRRADMrgEChBCb2FyZFJvb21TZXJ2aWNlEl0KDEdldEJvYXJkUm9vbRIlLmx1bWluZy5zdHVkaW8udjEuR2V0Qm9hcmRSb29tUmVxdWVzdBomLmx1bWluZy5zdHVkaW8udjEuR2V0Qm9hcmRSb29tUmVzcG9uc2UScgoTVXBkYXRlQm9hcmRQcmVzZW5jZRIsLmx1bWluZy5zdHVkaW8udjEuVXBkYXRlQm9hcmRQcmVzZW5jZVJlcXVlc3QaLS5sdW1pbmcuc3R1ZGlvLnYxLlVwZGF0ZUJvYXJkUHJlc2VuY2VSZXNwb25zZRJvChJMZWF2ZUJvYXJkUHJlc2VuY2USKy5sdW1pbmcuc3R1ZGlvLnYxLkxlYXZlQm9hcmRQcmVzZW5jZVJlcXVlc3QaLC5sdW1pbmcuc3R1ZGlvLnYxLkxlYXZlQm9hcmRQcmVzZW5jZVJlc3BvbnNlEmkKEENoYW5nZUJvYXJkVGltZXISKS5sdW1pbmcuc3R1ZGlvLnYxLkNoYW5nZUJvYXJkVGltZXJSZXF1ZXN0GioubHVtaW5nLnN0dWRpby52MS5DaGFuZ2VCb2FyZFRpbWVyUmVzcG9uc2USdQoUR2V0Qm9hcmRUaW1lclJlY2VpcHQSLS5sdW1pbmcuc3R1ZGlvLnYxLkdldEJvYXJkVGltZXJSZWNlaXB0UmVxdWVzdBouLmx1bWluZy5zdHVkaW8udjEuR2V0Qm9hcmRUaW1lclJlY2VpcHRSZXNwb25zZWIGcHJvdG8z", [file_luming_studio_v1_whiteboard_scene]);
var BoardRoomEventSchema = /* @__PURE__ */ messageDesc(file_luming_studio_v1_board_room_service, 13);
var BoardRoomTimerPhaseSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_room_service, 0);
var BoardRoomTimerPhase = /* @__PURE__ */ tsEnum(BoardRoomTimerPhaseSchema);
var BoardTimerRejectionSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_room_service, 1);
var BoardTimerRejection = /* @__PURE__ */ tsEnum(BoardTimerRejectionSchema);
var BoardRoomService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_board_room_service, 0);

// ../../packages/contracts/dist/proto/luming/studio/v1/board_sharing_service_pb.js
var file_luming_studio_v1_board_sharing_service = /* @__PURE__ */ fileDesc("CixsdW1pbmcvc3R1ZGlvL3YxL2JvYXJkX3NoYXJpbmdfc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSIqChZHZXRCb2FyZFNoYXJpbmdSZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJIkoKF0dldEJvYXJkU2hhcmluZ1Jlc3BvbnNlEi8KB3NoYXJpbmcYASABKAsyHi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU2hhcmluZyLKAgoMQm9hcmRTaGFyaW5nEhAKCGJvYXJkX2lkGAEgASgJEg8KB2VuYWJsZWQYAiABKAgSLQoFc2NvcGUYAyABKA4yHi5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdTY29wZRIUCgd2ZXJzaW9uGAQgASgESACIAQESKwoEcm9sZRgFIAEoDjIdLmx1bWluZy5zdHVkaW8udjEuU2hhcmluZ1JvbGUSEAoIY2FuX2VkaXQYBiABKAgSEwoLY2FuX2NvbW1lbnQYByABKAgSLAoFbGlua3MYCCADKAsyHS5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdMaW5rEjAKB21lbWJlcnMYCSADKAsyHy5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdNZW1iZXISEgoKbWVtYmVyX3VybBgKIAEoCUIKCghfdmVyc2lvbiJYCgtTaGFyaW5nTGluaxIrCgRyb2xlGAEgASgOMh0ubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUm9sZRIPCgdlbmFibGVkGAIgASgIEgsKA3VybBgDIAEoCSJ9Cg1TaGFyaW5nTWVtYmVyEhAKCGFjdG9yX2lkGAEgASgJEgwKBG5hbWUYAiABKAkSKwoEcm9sZRgDIAEoDjIdLmx1bWluZy5zdHVkaW8udjEuU2hhcmluZ1JvbGUSDwoHcmVtb3ZlZBgEIAEoCBIOCgZhY3RpdmUYBSABKAgihAUKGVVwZGF0ZUJvYXJkU2hhcmluZ1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRIdChBleHBlY3RlZF92ZXJzaW9uGAMgASgESAGIAQESNgoJc2V0X3Njb3BlGAQgASgLMiEubHVtaW5nLnN0dWRpby52MS5TZXRTaGFyaW5nU2NvcGVIABIyCgRzdG9wGAUgASgLMiIubHVtaW5nLnN0dWRpby52MS5TdG9wQm9hcmRTaGFyaW5nSAASQAoOc2V0X2ludml0YXRpb24YBiABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLlNldFNoYXJpbmdJbnZpdGF0aW9uSAASRAoQcmVzZXRfaW52aXRhdGlvbhgHIAEoCzIoLmx1bWluZy5zdHVkaW8udjEuUmVzZXRTaGFyaW5nSW52aXRhdGlvbkgAEkcKEmNoYW5nZV9tZW1iZXJfcm9sZRgIIAEoCzIpLmx1bWluZy5zdHVkaW8udjEuQ2hhbmdlU2hhcmluZ01lbWJlclJvbGVIABI+Cg1yZW1vdmVfbWVtYmVyGAkgASgLMiUubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nTWVtYmVyVGFyZ2V0SAASQwoOcmVzdG9yZV9tZW1iZXIYCiABKAsyKS5sdW1pbmcuc3R1ZGlvLnYxLkNoYW5nZVNoYXJpbmdNZW1iZXJSb2xlSAASPgoNZm9yZ2V0X21lbWJlchgLIAEoCzIlLmx1bWluZy5zdHVkaW8udjEuU2hhcmluZ01lbWJlclRhcmdldEgAQgsKCW9wZXJhdGlvbkITChFfZXhwZWN0ZWRfdmVyc2lvbiJACg9TZXRTaGFyaW5nU2NvcGUSLQoFc2NvcGUYASABKA4yHi5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdTY29wZSISChBTdG9wQm9hcmRTaGFyaW5nIlQKFFNldFNoYXJpbmdJbnZpdGF0aW9uEisKBHJvbGUYASABKA4yHS5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdSb2xlEg8KB2VuYWJsZWQYAiABKAgiRQoWUmVzZXRTaGFyaW5nSW52aXRhdGlvbhIrCgRyb2xlGAEgASgOMh0ubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUm9sZSJYChdDaGFuZ2VTaGFyaW5nTWVtYmVyUm9sZRIQCghhY3Rvcl9pZBgBIAEoCRIrCgRyb2xlGAIgASgOMh0ubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUm9sZSInChNTaGFyaW5nTWVtYmVyVGFyZ2V0EhAKCGFjdG9yX2lkGAEgASgJIlYKGlVwZGF0ZUJvYXJkU2hhcmluZ1Jlc3BvbnNlEjgKB3JlY2VpcHQYASABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdDb21tYW5kUmVjZWlwdCJFCh1HZXRCb2FyZFNoYXJpbmdSZWNlaXB0UmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJIloKHkdldEJvYXJkU2hhcmluZ1JlY2VpcHRSZXNwb25zZRI4CgdyZWNlaXB0GAEgASgLMicubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nQ29tbWFuZFJlY2VpcHQiwgEKFVNoYXJpbmdDb21tYW5kUmVjZWlwdBIQCghib2FyZF9pZBgBIAEoCRISCgpjb21tYW5kX2lkGAIgASgJEjoKB2FwcGxpZWQYAyABKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdDb21tYW5kQXBwbGllZEgAEjwKCHJlamVjdGVkGAQgASgLMigubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nQ29tbWFuZFJlamVjdGVkSABCCQoHb3V0Y29tZSI5ChVTaGFyaW5nQ29tbWFuZEFwcGxpZWQSFAoHdmVyc2lvbhgBIAEoBEgAiAEBQgoKCF92ZXJzaW9uIlIKFlNoYXJpbmdDb21tYW5kUmVqZWN0ZWQSOAoGcmVhc29uGAEgASgOMigubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUmVqZWN0aW9uUmVhc29uIksKHUluc3BlY3RCb2FyZEludml0YXRpb25SZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhgKEGludml0YXRpb25fdG9rZW4YAiABKAkilAEKHkluc3BlY3RCb2FyZEludml0YXRpb25SZXNwb25zZRI1CgppbnZpdGF0aW9uGAEgASgLMiEubHVtaW5nLnN0dWRpby52MS5Cb2FyZEludml0YXRpb24SOwoJcmVqZWN0aW9uGAIgASgOMigubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUmVqZWN0aW9uUmVhc29uIl8KD0JvYXJkSW52aXRhdGlvbhIQCghib2FyZF9pZBgBIAEoCRINCgV0aXRsZRgCIAEoCRIrCgRyb2xlGAMgASgOMh0ubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nUm9sZSJWChpKb2luQm9hcmRJbnZpdGF0aW9uUmVxdWVzdBIQCghib2FyZF9pZBgBIAEoCRIYChBpbnZpdGF0aW9uX3Rva2VuGAIgASgJEgwKBG5hbWUYAyABKAkikgEKG0pvaW5Cb2FyZEludml0YXRpb25SZXNwb25zZRI2CgdzZXNzaW9uGAEgASgLMiUubHVtaW5nLnN0dWRpby52MS5TaGFyaW5nR3Vlc3RTZXNzaW9uEjsKCXJlamVjdGlvbhgCIAEoDjIoLmx1bWluZy5zdHVkaW8udjEuU2hhcmluZ1JlamVjdGlvblJlYXNvbiK9AQoTU2hhcmluZ0d1ZXN0U2Vzc2lvbhIQCghib2FyZF9pZBgBIAEoCRIQCghhY3Rvcl9pZBgCIAEoCRIMCgRuYW1lGAMgASgJEisKBHJvbGUYBCABKA4yHS5sdW1pbmcuc3R1ZGlvLnYxLlNoYXJpbmdSb2xlEhQKB3ZlcnNpb24YBSABKARIAIgBARIQCghjYW5fZWRpdBgGIAEoCBITCgtjYW5fY29tbWVudBgHIAEoCEIKCghfdmVyc2lvbiqRAQoLU2hhcmluZ1JvbGUSHAoYU0hBUklOR19ST0xFX1VOU1BFQ0lGSUVEEAASFgoSU0hBUklOR19ST0xFX09XTkVSEAESFwoTU0hBUklOR19ST0xFX0VESVRPUhACEhoKFlNIQVJJTkdfUk9MRV9DT01NRU5URVIQAxIXChNTSEFSSU5HX1JPTEVfVklFV0VSEAQqXQoMU2hhcmluZ1Njb3BlEh0KGVNIQVJJTkdfU0NPUEVfVU5TUEVDSUZJRUQQABIXChNTSEFSSU5HX1NDT1BFX0xPQ0FMEAESFQoRU0hBUklOR19TQ09QRV9MQU4QAireAwoWU2hhcmluZ1JlamVjdGlvblJlYXNvbhIoCiRTSEFSSU5HX1JFSkVDVElPTl9SRUFTT05fVU5TUEVDSUZJRUQQABImCiJTSEFSSU5HX1JFSkVDVElPTl9SRUFTT05fRk9SQklEREVOEAESLAooU0hBUklOR19SRUpFQ1RJT05fUkVBU09OX1ZFUlNJT05fQ0hBTkdFRBACEi0KKVNIQVJJTkdfUkVKRUNUSU9OX1JFQVNPTl9DT01NQU5EX0lEX1JFVVNFEAMSLAooU0hBUklOR19SRUpFQ1RJT05fUkVBU09OX0lOVkFMSURfQ09NTUFORBAEEiwKKFNIQVJJTkdfUkVKRUNUSU9OX1JFQVNPTl9MQU5fVU5BVkFJTEFCTEUQBRIzCi9TSEFSSU5HX1JFSkVDVElPTl9SRUFTT05fSU5WSVRBVElPTl9VTkFWQUlMQUJMRRAGEicKI1NIQVJJTkdfUkVKRUNUSU9OX1JFQVNPTl9OQU1FX1RBS0VOEAcSLworU0hBUklOR19SRUpFQ1RJT05fUkVBU09OX01FTUJFUl9VTkFWQUlMQUJMRRAIEioKJlNIQVJJTkdfUkVKRUNUSU9OX1JFQVNPTl9ST0xFX0RJU0FCTEVEEAky3AQKE0JvYXJkU2hhcmluZ1NlcnZpY2USZgoPR2V0Qm9hcmRTaGFyaW5nEigubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFNoYXJpbmdSZXF1ZXN0GikubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFNoYXJpbmdSZXNwb25zZRJvChJVcGRhdGVCb2FyZFNoYXJpbmcSKy5sdW1pbmcuc3R1ZGlvLnYxLlVwZGF0ZUJvYXJkU2hhcmluZ1JlcXVlc3QaLC5sdW1pbmcuc3R1ZGlvLnYxLlVwZGF0ZUJvYXJkU2hhcmluZ1Jlc3BvbnNlEnsKFkdldEJvYXJkU2hhcmluZ1JlY2VpcHQSLy5sdW1pbmcuc3R1ZGlvLnYxLkdldEJvYXJkU2hhcmluZ1JlY2VpcHRSZXF1ZXN0GjAubHVtaW5nLnN0dWRpby52MS5HZXRCb2FyZFNoYXJpbmdSZWNlaXB0UmVzcG9uc2USewoWSW5zcGVjdEJvYXJkSW52aXRhdGlvbhIvLmx1bWluZy5zdHVkaW8udjEuSW5zcGVjdEJvYXJkSW52aXRhdGlvblJlcXVlc3QaMC5sdW1pbmcuc3R1ZGlvLnYxLkluc3BlY3RCb2FyZEludml0YXRpb25SZXNwb25zZRJyChNKb2luQm9hcmRJbnZpdGF0aW9uEiwubHVtaW5nLnN0dWRpby52MS5Kb2luQm9hcmRJbnZpdGF0aW9uUmVxdWVzdBotLmx1bWluZy5zdHVkaW8udjEuSm9pbkJvYXJkSW52aXRhdGlvblJlc3BvbnNlYgZwcm90bzM");
var SharingRoleSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_sharing_service, 0);
var SharingRole = /* @__PURE__ */ tsEnum(SharingRoleSchema);
var SharingScopeSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_sharing_service, 1);
var SharingScope = /* @__PURE__ */ tsEnum(SharingScopeSchema);
var SharingRejectionReasonSchema = /* @__PURE__ */ enumDesc(file_luming_studio_v1_board_sharing_service, 2);
var SharingRejectionReason = /* @__PURE__ */ tsEnum(SharingRejectionReasonSchema);
var BoardSharingService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_board_sharing_service, 0);

// src/entrypoints/http/room-route-wire.ts
var phases = {
  idle: BoardRoomTimerPhase.IDLE,
  running: BoardRoomTimerPhase.RUNNING,
  paused: BoardRoomTimerPhase.PAUSED,
  ended: BoardRoomTimerPhase.ENDED
};
var rejections2 = {
  forbidden: BoardTimerRejection.FORBIDDEN,
  invalidAction: BoardTimerRejection.INVALID_ACTION,
  commandIdReuse: BoardTimerRejection.COMMAND_ID_REUSE
};
var encodedFrames = /* @__PURE__ */ new WeakMap();
var maximumFrameCharacters = 128 * 1024;
function timerWire({
  version,
  phase,
  durationMs,
  deadlineUnixMs,
  remainingMs
}) {
  return {
    version,
    phase: phases[phase],
    durationMs,
    deadlineUnixMs: deadlineUnixMs === void 0 ? void 0 : BigInt(deadlineUnixMs),
    remainingMs
  };
}
function participantWire(participant) {
  return { ...participant, expiresAtUnixMs: BigInt(participant.expiresAtUnixMs) };
}
function payloadWire(payload) {
  switch (payload.kind) {
    case "snapshot": {
      const { actorId: actorId2, canEdit, boardRevision, participants, timer } = payload.snapshot;
      return {
        case: "snapshot",
        value: {
          actorId: actorId2,
          canEdit,
          boardRevision,
          participants: participants.map(participantWire),
          timer: timerWire(timer)
        }
      };
    }
    case "participants": {
      const { upserts, removals } = payload.changes;
      return {
        case: "participants",
        value: { upserts: upserts.map(participantWire), removals: [...removals] }
      };
    }
    case "timer":
      return { case: "timer", value: timerWire(payload.timer) };
    case "contentChanged": {
      const { boardRevision, changedObjectIds, removedObjectIds, changedObjects, refreshScene } = payload.change;
      return {
        case: "contentChanged",
        value: {
          boardRevision,
          changedObjectIds: [...changedObjectIds ?? []],
          removedObjectIds: [...removedObjectIds ?? []],
          changedObjects: changedObjects?.map((object) => fromBinary(ObjectMetadataSchema, object)),
          refreshScene
        }
      };
    }
    case "accessLost":
      return { case: "accessLost", value: {} };
  }
}
function eventWire(event) {
  const { boardId, roomInstanceId, sequence: sequence2, serverTimeUnixMs, payload } = event;
  return {
    boardId,
    roomInstanceId,
    sequence: sequence2,
    serverTimeUnixMs: BigInt(serverTimeUnixMs),
    payload: payloadWire(payload)
  };
}
function encodeFrame(event) {
  const wire = create(BoardRoomEventSchema, eventWire(event));
  const data = JSON.stringify(toJson(BoardRoomEventSchema, wire));
  return "id: " + event.sequence + "\ndata: " + data + "\n\n";
}
function eventFrame(event) {
  const cached = encodedFrames.get(event);
  if (cached !== void 0) {
    return cached;
  }
  const full = encodeFrame(event);
  const payload = event.payload;
  const compact = full.length > maximumFrameCharacters && payload.kind === "contentChanged";
  const considered = compact ? encodeFrame({
    ...event,
    payload: {
      kind: "contentChanged",
      change: {
        boardId: event.boardId,
        boardRevision: payload.change.boardRevision,
        refreshScene: true
      }
    }
  }) : full;
  encodedFrames.set(event, considered);
  return considered;
}
function receiptWire({
  boardId,
  commandId,
  outcome
}) {
  switch (outcome.kind) {
    case "applied":
    case "conflict":
      return {
        boardId,
        commandId,
        outcome: { case: outcome.kind, value: { timer: timerWire(outcome.timer) } }
      };
    case "rejected":
      return {
        boardId,
        commandId,
        outcome: { case: "rejected", value: { reason: rejections2[outcome.reason] } }
      };
  }
}

// src/entrypoints/http/room-route-events.ts
var roomPath = "/studio-room-events";
var recheckIntervalMs = 1500;
var maxRoomEventCharacters = 128 * 1024;
var headers = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no"
};
function roomEventPath(url) {
  return url?.split("?", 1)[0] === roomPath;
}
function authorizedBoard(actor, boardId) {
  try {
    actor.authorize?.({ boardId });
    return true;
  } catch (error) {
    if (error instanceof SharingAccessError) {
      return false;
    }
    throw error;
  }
}
var RoomStream = class {
  constructor(options) {
    this.options = options;
  }
  options;
  interval;
  release;
  baseline;
  last;
  stopped = false;
  backpressured = false;
  open() {
    const { application, boardId, key, response } = this.options;
    const subscription = application.subscribe(boardId, key, {
      deliver: (event) => this.run(() => this.deliver(event)),
      close: () => this.end(),
      recheck: () => this.run(() => {
        this.checkAccess();
      })
    });
    this.release = subscription.release;
    this.baseline = subscription.access;
    this.last = subscription.initial;
    response.once("close", () => this.stop());
    response.on("drain", () => {
      this.backpressured = false;
    });
    response.writeHead(200, headers);
    this.write(eventFrame(subscription.initial));
    if (!this.stopped) {
      this.interval = setInterval(() => this.run(() => this.tick()), recheckIntervalMs);
      this.interval.unref();
    }
  }
  currentAccess() {
    const { application, boardId, key, authorize } = this.options;
    const actor = authorize();
    if (actor?.id !== key.actorId || !authorizedBoard(actor, boardId)) {
      return void 0;
    }
    const live = application.access(boardId, key.actorId);
    const baseline2 = this.baseline;
    if (live?.canEdit === baseline2?.canEdit && live?.role === baseline2?.role) {
      return live;
    }
  }
  checkAccess() {
    const access = this.currentAccess();
    if (!access) {
      this.accessLost();
    }
    return access;
  }
  deliver(event) {
    if (!this.checkAccess()) {
      return;
    }
    this.last = event;
    this.write(eventFrame(event));
  }
  tick() {
    const access = this.checkAccess();
    if (!access) {
      return;
    }
    this.options.application.tick(this.options.boardId, access.boardRevision);
    if (!this.backpressured) {
      this.write(": keepalive\n\n");
    }
  }
  write(frame) {
    if (this.stopped || this.options.response.destroyed) {
      return;
    }
    if (frame.length > maxRoomEventCharacters || this.backpressured) {
      this.end();
      return;
    }
    this.backpressured = !this.options.response.write(frame);
  }
  accessLost() {
    if (this.stopped) {
      return;
    }
    const last = this.last;
    const terminal = last && eventFrame({
      ...last,
      sequence: last.sequence + 1n,
      payload: { kind: "accessLost" }
    });
    this.end(terminal);
    const { application, boardId, key } = this.options;
    application.revokeView(boardId, key);
  }
  run(action) {
    if (this.stopped) {
      return;
    }
    try {
      action();
    } catch (error) {
      this.end();
      this.options.reportError(error);
    }
  }
  stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    clearInterval(this.interval);
    this.release?.();
  }
  end(frame) {
    this.stop();
    if (!this.options.response.destroyed) {
      this.options.response.end(frame);
    }
  }
};
function readScope(request) {
  const url = URL.parse(request.url ?? "", "http://127.0.0.1");
  if (!url) {
    return void 0;
  }
  const boardId = url.searchParams.get("boardId") ?? "";
  const viewId = url.searchParams.get("viewId") ?? "";
  if (boardId.trim() && boardId.length <= 160 && viewId.trim()) {
    return { boardId, viewId };
  }
}
function serveRoomEvents(application, request, response, authorize, reportError) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendStatus(response, 405);
    return;
  }
  const scope2 = readScope(request);
  if (!scope2) {
    sendStatus(response, 400);
    return;
  }
  const actor = authorize();
  if (!actor) {
    sendStatus(response, 401);
    return;
  }
  try {
    const { boardId, viewId } = scope2;
    if (!authorizedBoard(actor, boardId)) {
      sendStatus(response, 403);
      return;
    }
    new RoomStream({
      application,
      boardId,
      key: { viewId, actorId: actor.id },
      response,
      authorize,
      reportError
    }).open();
  } catch (error) {
    if (error instanceof RoomAccessError) {
      sendStatus(response, 403);
      return;
    }
    if (error instanceof RoomCapacityError) {
      sendStatus(response, 503);
      return;
    }
    if (error instanceof RoomInputError) {
      sendStatus(response, 400);
      return;
    }
    throw error;
  }
}

// src/entrypoints/http/room-routes.ts
var {
  getBoardRoom,
  updateBoardPresence,
  leaveBoardPresence,
  changeBoardTimer,
  getBoardTimerReceipt
} = BoardRoomService.method;
function roomId(id) {
  const value = requireId(id);
  if (value.length > 160) {
    throw new HttpRequestError(400, "Room identifiers are too long");
  }
  return value;
}
function requireVersion2(value) {
  if (value === void 0) {
    throw new HttpRequestError(400, "A room sequence or version is required");
  }
  return value;
}
function actionOf(action) {
  switch (action.case) {
    case "start":
    case "pause":
    case "resume":
    case "reset":
      return { kind: action.case };
    case "setDurationMs":
      return { kind: "setDuration", milliseconds: action.value };
    case "adjustDurationMs":
      return { kind: "adjustDuration", milliseconds: action.value };
    case void 0:
      throw new HttpRequestError(400, "A timer action is required");
  }
}
function readPresence(request) {
  const { viewId, sequence: sequence2, cursor, viewport, following } = request;
  return {
    viewId: roomId(viewId),
    sequence: requireVersion2(sequence2),
    cursor: cursor && { x: cursor.x, y: cursor.y },
    viewport: viewport && {
      centerX: viewport.centerX,
      centerY: viewport.centerY,
      zoom: viewport.zoom,
      width: viewport.width,
      height: viewport.height
    },
    following
  };
}
function createRoomRoutes(application) {
  return [
    unaryRoute(getBoardRoom, (actor, request) => ({
      event: eventWire(application.snapshot(roomId(request.boardId), actor.id))
    })),
    unaryRoute(updateBoardPresence, (actor, request) => ({
      accepted: application.publishPresence(
        roomId(request.boardId),
        actor.id,
        readPresence(request)
      )
    })),
    unaryRoute(leaveBoardPresence, (actor, request) => ({
      accepted: application.leavePresence(
        roomId(request.boardId),
        { actorId: actor.id, viewId: roomId(request.viewId) },
        requireVersion2(request.sequence)
      )
    })),
    unaryRoute(changeBoardTimer, (actor, request) => {
      const result = application.changeTimer(actor.id, {
        boardId: roomId(request.boardId),
        commandId: roomId(request.commandId),
        expectedVersion: requireVersion2(request.expectedVersion),
        action: actionOf(request.action)
      });
      return {
        receipt: result.receipt && receiptWire(result.receipt),
        serverTimeUnixMs: BigInt(result.serverTimeUnixMs)
      };
    }),
    unaryRoute(getBoardTimerReceipt, (actor, request) => {
      const result = application.timerReceipt(actor.id, {
        boardId: roomId(request.boardId),
        commandId: roomId(request.commandId)
      });
      return {
        receipt: result.receipt && receiptWire(result.receipt),
        serverTimeUnixMs: BigInt(result.serverTimeUnixMs)
      };
    })
  ];
}

// src/entrypoints/http/share-routes.ts
var wireRoles = {
  owner: SharingRole.OWNER,
  editor: SharingRole.EDITOR,
  commenter: SharingRole.COMMENTER,
  viewer: SharingRole.VIEWER
};
var wireRejection = {
  forbidden: SharingRejectionReason.FORBIDDEN,
  versionChanged: SharingRejectionReason.VERSION_CHANGED,
  commandIdReuse: SharingRejectionReason.COMMAND_ID_REUSE,
  invalidCommand: SharingRejectionReason.INVALID_COMMAND,
  lanUnavailable: SharingRejectionReason.LAN_UNAVAILABLE,
  invitationUnavailable: SharingRejectionReason.INVITATION_UNAVAILABLE,
  nameTaken: SharingRejectionReason.NAME_TAKEN,
  memberUnavailable: SharingRejectionReason.MEMBER_UNAVAILABLE,
  roleDisabled: SharingRejectionReason.ROLE_DISABLED
};
function scope(value) {
  if (value === SharingScope.LOCAL) {
    return "local";
  }
  if (value === SharingScope.LAN) {
    return "lan";
  }
  throw new HttpRequestError(400, "Invalid sharing scope.");
}
function guestRole(value) {
  switch (value) {
    case SharingRole.EDITOR:
      return "editor";
    case SharingRole.COMMENTER:
      return "commenter";
    case SharingRole.VIEWER:
      return "viewer";
    case SharingRole.UNSPECIFIED:
    case SharingRole.OWNER:
      throw new HttpRequestError(400, "Invalid invitation role.");
  }
  throw new HttpRequestError(400, "Invalid invitation role.");
}
function readOperation2(operation) {
  switch (operation.case) {
    case "setScope":
      return { kind: operation.case, scope: scope(operation.value.scope) };
    case "stop":
      return { kind: operation.case };
    case "setInvitation":
      return {
        kind: operation.case,
        role: guestRole(operation.value.role),
        enabled: operation.value.enabled
      };
    case "resetInvitation":
      return {
        kind: operation.case,
        role: operation.value.role === SharingRole.UNSPECIFIED ? void 0 : guestRole(operation.value.role)
      };
    case "changeMemberRole":
    case "restoreMember":
      return {
        kind: operation.case,
        actorId: requireId(operation.value.actorId),
        role: guestRole(operation.value.role)
      };
    case "removeMember":
    case "forgetMember":
      return { kind: operation.case, actorId: requireId(operation.value.actorId) };
    case void 0:
      throw new HttpRequestError(400, "A sharing operation is required.");
  }
}
function readCommand(request) {
  const { boardId, commandId, expectedVersion, operation } = request;
  if (expectedVersion === void 0) {
    throw new HttpRequestError(400, "The expected sharing version is required.");
  }
  return {
    boardId: requireId(boardId),
    commandId: requireId(commandId),
    expectedVersion,
    operation: readOperation2(operation)
  };
}
function writeSharing(sharing) {
  return {
    ...sharing,
    scope: sharing.scope === "local" ? SharingScope.LOCAL : SharingScope.LAN,
    role: wireRoles[sharing.role],
    links: sharing.links.map((link) => ({ ...link, role: wireRoles[link.role] })),
    members: sharing.members.map((member) => ({ ...member, role: wireRoles[member.role] }))
  };
}
function writeReceipt2({
  boardId,
  commandId,
  outcome
}) {
  return {
    boardId,
    commandId,
    outcome: outcome.kind === "applied" ? { case: "applied", value: { version: outcome.version } } : { case: "rejected", value: { reason: wireRejection[outcome.reason] } }
  };
}
async function update(options, actorId2, command) {
  const { application, activateScope } = options;
  const checked = application.prepareUpdate(actorId2, command);
  if (checked) {
    return writeReceipt2(checked);
  }
  if (command.operation.kind === "setScope" && activateScope) {
    try {
      await activateScope(command.operation.scope);
    } catch (error) {
      options.onActivationError(error);
      return writeReceipt2({
        boardId: command.boardId,
        commandId: command.commandId,
        outcome: { kind: "rejected", reason: "lanUnavailable" }
      });
    }
  }
  const receipt = application.update(actorId2, command);
  if (receipt.outcome.kind === "applied") {
    options.onAccessChanged?.(command.boardId);
  }
  return writeReceipt2(receipt);
}
function createSharingRoutes(options) {
  const { application } = options;
  const { getBoardSharing, updateBoardSharing, getBoardSharingReceipt } = BoardSharingService.method;
  return [
    unaryRoute(getBoardSharing, (actor, { boardId }) => ({
      sharing: writeSharing(application.getSharing(requireId(boardId), actor.id, actor.guestScope))
    })),
    asyncUnaryRoute(updateBoardSharing, async (actor, request) => ({
      receipt: await update(options, actor.id, readCommand(request))
    })),
    unaryRoute(getBoardSharingReceipt, (actor, { boardId, commandId }) => {
      const receipt = application.getReceipt(requireId(boardId), actor.id, requireId(commandId));
      return { receipt: receipt && writeReceipt2(receipt) };
    })
  ];
}

// src/entrypoints/http/guest-sharing.ts
var cookieName = "luming-studio-ii-guest";
var cookieLifetimeSeconds = 31536e3;
var invitationBodyLimit = 16 * 1024;
function path(method) {
  return "/" + method.parent.typeName + "/" + method.name;
}
var paths = /* @__PURE__ */ new Map([
  [path(WhiteboardService.method.getBoardScene), "read"],
  [path(WhiteboardService.method.getObjectPayloads), "read"],
  [path(WhiteboardService.method.exportBoard), "read"],
  [path(WhiteboardService.method.moveObjects), "edit"],
  [path(WhiteboardService.method.getCommandReceipt), "edit"],
  [path(BoardEditService.method.editBoardGeometry), "edit"],
  [path(BoardEditService.method.editObjectContent), "edit"],
  [path(BoardEditService.method.attachBoardImage), "edit"],
  [path(BoardEditService.method.getBoardEditReceipt), "edit"],
  [path(BoardHistoryService.method.listBoardVersions), "read"],
  [path(BoardHistoryService.method.getBoardVersionScene), "read"],
  [path(BoardHistoryService.method.getBoardVersionPayloads), "read"],
  [path(BoardHistoryService.method.exportBoardVersion), "read"],
  [path(BoardHistoryService.method.restoreBoardVersion), "edit"],
  [path(FeedbackService.method.listThreads), "read"],
  [path(FeedbackService.method.getThread), "read"],
  [path(FeedbackService.method.applyFeedback), "comment"],
  [path(FeedbackService.method.getFeedbackReceipt), "comment"],
  [path(BoardSharingService.method.getBoardSharing), "read"],
  [path(BoardRoomService.method.getBoardRoom), "read"],
  [path(BoardRoomService.method.updateBoardPresence), "read"],
  [path(BoardRoomService.method.leaveBoardPresence), "read"],
  [path(BoardRoomService.method.changeBoardTimer), "edit"],
  [path(BoardRoomService.method.getBoardTimerReceipt), "edit"]
]);
var { inspectBoardInvitation, joinBoardInvitation } = BoardSharingService.method;
var inspectPath = path(inspectBoardInvitation);
var joinPath = path(joinBoardInvitation);
function isGuestInvitationPath(value) {
  return value === inspectPath || value === joinPath;
}
function guestAccessForPath(value) {
  const readable = value.startsWith("/studio-archive-assets/") || roomEventPath(value);
  return readable ? "read" : paths.get(value);
}
function allowsGuestOrigin(request, guest) {
  const origin = request.headers.origin;
  return origin === void 0 || origin === guest.origin();
}
function readBrowserToken(request) {
  const prefix = cookieName + "=";
  const cookies = request.headers.cookie?.split(";").map((part) => part.trim());
  const matches = cookies?.filter((part) => part.startsWith(prefix));
  if (matches?.length === 1) {
    const token2 = matches[0]?.slice(prefix.length);
    return token2 && validBrowserCredential(token2) ? token2 : void 0;
  }
}
function stagedToken(request, options) {
  const previous = readBrowserToken(request);
  if (previous && !options.application.browserTokenExpired(previous)) {
    return { token: previous, fresh: false };
  }
  return { token: options.newBrowserToken(), fresh: true };
}
function setCookie(response, token2, guest) {
  const secure = guest.origin()?.startsWith("https:") ? "; Secure" : "";
  response.setHeader(
    "set-cookie",
    cookieName + "=" + token2 + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + cookieLifetimeSeconds + secure
  );
}
function boardIdIn(value) {
  if ("boardId" in value && typeof value.boardId === "string") {
    return requireId(value.boardId);
  }
  throw new SharingAccessError("Board-scoped guest access is required.");
}
function permits(session, access) {
  switch (access) {
    case "read":
      return true;
    case "edit":
      return session.canEdit;
    case "comment":
      return session.canComment;
  }
}
function resolveGuestActor(request, options, guest, access) {
  const token2 = readBrowserToken(request);
  const actorId2 = token2 ? options.application.browserActor(token2) : void 0;
  if (!actorId2) {
    return void 0;
  }
  return {
    id: actorId2,
    guestScope: guest.scope,
    authorize(value) {
      const boardId = boardIdIn(value);
      const session = options.application.guestAccess(boardId, actorId2, guest.scope);
      if (!session || !permits(session, access)) {
        throw new SharingAccessError("Guest access to this board is unavailable.");
      }
    }
  };
}
function inspectInvitation(request, response, options, guest, bytes) {
  const { boardId, invitationToken } = decodeRequest(inspectBoardInvitation.input, bytes);
  const result = options.application.inspectInvitation({
    boardId: requireId(boardId),
    invitationToken,
    scope: guest.scope
  });
  if ("value" in result) {
    const browser = stagedToken(request, options);
    if (browser.fresh) {
      setCookie(response, browser.token, guest);
    }
  }
  const value = "value" in result ? { invitation: { ...result.value, role: wireRoles[result.value.role] } } : { rejection: wireRejection[result.rejection] };
  const schema2 = inspectBoardInvitation.output;
  sendProtobuf(response, toBinary(schema2, create(schema2, value)));
}
function joinInvitation(request, response, options, guest, bytes) {
  const { boardId, invitationToken, name } = decodeRequest(joinBoardInvitation.input, bytes);
  const browser = stagedToken(request, options);
  const result = options.application.joinInvitation({
    boardId: requireId(boardId),
    invitationToken,
    name,
    scope: guest.scope,
    browserToken: browser.token
  });
  if ("value" in result && browser.fresh) {
    setCookie(response, browser.token, guest);
  }
  const value = "value" in result ? { session: { ...result.value, role: wireRoles[result.value.role] } } : { rejection: wireRejection[result.rejection] };
  const schema2 = joinBoardInvitation.output;
  sendProtobuf(response, toBinary(schema2, create(schema2, value)));
}
async function handleGuestInvitation(request, response, options, guest) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendStatus(response, 405);
    return;
  }
  if (mediaType(request) !== protobufContentType) {
    sendStatus(response, 415);
    return;
  }
  const bytes = await readBody(request, invitationBodyLimit);
  if (request.url === inspectPath) {
    inspectInvitation(request, response, options, guest, bytes);
  } else {
    joinInvitation(request, response, options, guest, bytes);
  }
}

// src/entrypoints/http/room-changes.ts
function observeRoomChange(rooms, reportError) {
  function publish(outcome) {
    if (!rooms || outcome.outcome.kind !== "applied") {
      return;
    }
    const receipt = outcome.outcome;
    try {
      const orderChanged = "order" in receipt && Boolean(receipt.order);
      const expired = "detailsExpired" in receipt && receipt.detailsExpired;
      const refreshScene = orderChanged || expired || receipt.objects.length > 64;
      if (refreshScene) {
        rooms.publishContentChange({
          boardId: outcome.boardId,
          boardRevision: receipt.boardRevision,
          refreshScene: true
        });
        return;
      }
      rooms.publishContentChange({
        boardId: outcome.boardId,
        boardRevision: receipt.boardRevision,
        changedObjectIds: receipt.objects.map(({ objectId }) => objectId),
        removedObjectIds: "removedObjectIds" in receipt ? receipt.removedObjectIds : [],
        changedObjects: receipt.objects.map(
          (object) => toBinary(ObjectMetadataSchema, toObjectMetadata(object))
        )
      });
    } catch (error) {
      reportError(error);
    }
  }
  return rooms ? publish : void 0;
}

// src/entrypoints/http/receipt.ts
var REJECTION_REASONS = {
  forbidden: MoveRejectionReason.FORBIDDEN,
  geometryLocked: MoveRejectionReason.GEOMETRY_LOCKED,
  invalidMove: MoveRejectionReason.INVALID_MOVE,
  commandIdReuse: MoveRejectionReason.COMMAND_ID_REUSE
};
function toCommandTarget(target2) {
  const { objectId, expectedGeometryVersion } = target2;
  if (expectedGeometryVersion === void 0) {
    throw new HttpRequestError(400, "Expected geometry version is required");
  }
  return { objectId, expectedGeometryVersion };
}
function toMoveCommand(request) {
  const { boardId, commandId, delta, targets } = request;
  if (!delta) {
    throw new HttpRequestError(400, "Move delta is required");
  }
  return {
    boardId: requireId(boardId),
    commandId: requireId(commandId),
    delta: { dx: delta.dx, dy: delta.dy },
    targets: targets.map(toCommandTarget)
  };
}
function toOutcome(outcome) {
  switch (outcome.kind) {
    case "applied":
      return {
        case: "applied",
        value: {
          boardRevision: outcome.boardRevision,
          objects: outcome.objects.map(toObjectMetadata)
        }
      };
    case "conflict":
      return {
        case: "conflict",
        value: {
          reason: outcome.reason === "targetsChanged" ? MoveConflictReason.TARGETS_CHANGED : MoveConflictReason.GEOMETRY_VERSION_CHANGED,
          boardRevision: outcome.boardRevision,
          currentObjects: outcome.currentObjects.map(toObjectMetadata),
          missingObjectIds: [...outcome.missingObjectIds]
        }
      };
    case "rejected":
      return { case: "rejected", value: { reason: REJECTION_REASONS[outcome.reason] } };
  }
}
function toCommandReceipt(receipt) {
  return create(CommandReceiptSchema, {
    boardId: receipt.boardId,
    commandId: receipt.commandId,
    outcome: toOutcome(receipt.outcome)
  });
}

// src/entrypoints/http/routes.ts
function createWhiteboardRoutes(application, observe) {
  const { getBoardScene, getObjectPayloads, moveObjects, getCommandReceipt } = WhiteboardService.method;
  return [
    createExportRoute(application),
    unaryRoute(getBoardScene, (actor, request) => ({
      scene: toBoardScene(application.getBoardScene(actor, requireId(request.boardId)))
    })),
    unaryRoute(getObjectPayloads, (actor, request) => {
      const boardId = requireId(request.boardId);
      const results = application.getObjectPayloads(actor, boardId, request.objectIds);
      return { boardId, results: results.map(toPayloadResult) };
    }),
    unaryRoute(moveObjects, (actor, request) => {
      const receipt = application.moveObjects(actor, toMoveCommand(request));
      observe?.(receipt);
      return { receipt: toCommandReceipt(receipt) };
    }),
    unaryRoute(getCommandReceipt, (actor, request) => {
      const boardId = requireId(request.boardId);
      const commandId = requireId(request.commandId);
      const receipt = application.getCommandReceipt(actor, boardId, commandId);
      return {
        result: receipt ? { case: "receipt", value: toCommandReceipt(receipt) } : { case: "notRecorded", value: { boardId, commandId } }
      };
    })
  ];
}

// ../../packages/contracts/dist/proto/luming/studio/v1/board_suggestion_service_pb.js
var file_luming_studio_v1_board_suggestion_service = /* @__PURE__ */ fileDesc("Ci9sdW1pbmcvc3R1ZGlvL3YxL2JvYXJkX3N1Z2dlc3Rpb25fc2VydmljZS5wcm90bxIQbHVtaW5nLnN0dWRpby52MSIqChRCb2FyZFJldmlld1NlbGVjdGlvbhISCgpvYmplY3RfaWRzGAEgAygJIu0BCh5DcmVhdGVCb2FyZFJldmlld1NvdXJjZVJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEgoKY29tbWFuZF9pZBgCIAEoCRI7CglzZWxlY3Rpb24YAyABKAsyJi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUmV2aWV3U2VsZWN0aW9uSAASHAoSZmVlZGJhY2tfdGhyZWFkX2lkGAQgASgJSAASJAoXZXhwZWN0ZWRfYm9hcmRfcmV2aXNpb24YBSABKARIAYgBAUIICgZvcmlnaW5CGgoYX2V4cGVjdGVkX2JvYXJkX3JldmlzaW9uIrwCChFCb2FyZFJldmlld1NvdXJjZRIRCglzb3VyY2VfaWQYASABKAkSEAoIYm9hcmRfaWQYAiABKAkSJAoXY2FwdHVyZWRfYm9hcmRfcmV2aXNpb24YAyABKARIAIgBARISCgpvYmplY3RfaWRzGAQgAygJEh8KEmZlZWRiYWNrX3RocmVhZF9pZBgFIAEoCUgBiAEBEjQKB3RhcmdldHMYBiADKAsyIy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkUmV2aWV3VGFyZ2V0EiMKFnRhcmdldHNfYm9hcmRfcmV2aXNpb24YByABKARIAogBAUIaChhfY2FwdHVyZWRfYm9hcmRfcmV2aXNpb25CFQoTX2ZlZWRiYWNrX3RocmVhZF9pZEIZChdfdGFyZ2V0c19ib2FyZF9yZXZpc2lvbiLIAQoRQm9hcmRSZXZpZXdUYXJnZXQSEQoJb2JqZWN0X2lkGAEgASgJEgwKBGtpbmQYAiABKAkSHQoQZ2VvbWV0cnlfdmVyc2lvbhgDIAEoBEgAiAEBEhwKD3BheWxvYWRfdmVyc2lvbhgEIAEoBEgBiAEBEiwKCGdlb21ldHJ5GAUgASgLMhoubHVtaW5nLnN0dWRpby52MS5HZW9tZXRyeUITChFfZ2VvbWV0cnlfdmVyc2lvbkISChBfcGF5bG9hZF92ZXJzaW9uIlYKH0NyZWF0ZUJvYXJkUmV2aWV3U291cmNlUmVzcG9uc2USMwoGc291cmNlGAEgASgLMiMubHVtaW5nLnN0dWRpby52MS5Cb2FyZFJldmlld1NvdXJjZSLvAQoaQm9hcmRTdWdnZXN0aW9uT3B0aW9uSW5wdXQSEQoJb3B0aW9uX2lkGAEgASgJEg0KBWxhYmVsGAIgASgJEhgKC2Rlc2NyaXB0aW9uGAMgASgJSAGIAQESPgoIZ2VvbWV0cnkYBCABKAsyKi5sdW1pbmcuc3R1ZGlvLnYxLkVkaXRCb2FyZEdlb21ldHJ5UmVxdWVzdEgAEj0KB2NvbnRlbnQYBSABKAsyKi5sdW1pbmcuc3R1ZGlvLnYxLkVkaXRPYmplY3RDb250ZW50UmVxdWVzdEgAQgYKBGVkaXRCDgoMX2Rlc2NyaXB0aW9uIqsBChxTdWJtaXRCb2FyZFN1Z2dlc3Rpb25SZXF1ZXN0EhAKCGJvYXJkX2lkGAEgASgJEhIKCmNvbW1hbmRfaWQYAiABKAkSEQoJc291cmNlX2lkGAMgASgJEhMKC29ic2VydmF0aW9uGAQgASgJEj0KB29wdGlvbnMYBSADKAsyLC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VnZ2VzdGlvbk9wdGlvbklucHV0ImMKFUJvYXJkU3VnZ2VzdGlvbk9wdGlvbhIRCglvcHRpb25faWQYASABKAkSDQoFbGFiZWwYAiABKAkSGAoLZGVzY3JpcHRpb24YAyABKAlIAIgBAUIOCgxfZGVzY3JpcHRpb24i4wIKD0JvYXJkU3VnZ2VzdGlvbhITCgtwcm9wb3NhbF9pZBgBIAEoCRIRCglzb3VyY2VfaWQYAiABKAkSEwoLb2JzZXJ2YXRpb24YAyABKAkSHQoQcHJvcG9zYWxfdmVyc2lvbhgEIAEoBEgAiAEBEhkKEWV4cGlyZXNfYXRfbWlsbGlzGAUgASgEEjgKB29wdGlvbnMYBiADKAsyJy5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VnZ2VzdGlvbk9wdGlvbhIfChJhY2NlcHRlZF9vcHRpb25faWQYByABKAlIAYgBARIkChdhY2NlcHRlZF9ib2FyZF9yZXZpc2lvbhgIIAEoBEgCiAEBEhAKCHJlamVjdGVkGAkgASgIQhMKEV9wcm9wb3NhbF92ZXJzaW9uQhUKE19hY2NlcHRlZF9vcHRpb25faWRCGgoYX2FjY2VwdGVkX2JvYXJkX3JldmlzaW9uIlYKHVN1Ym1pdEJvYXJkU3VnZ2VzdGlvblJlc3BvbnNlEjUKCnN1Z2dlc3Rpb24YASABKAsyIS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VnZ2VzdGlvbiJ2ChtMaXN0Qm9hcmRTdWdnZXN0aW9uc1JlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSDQoFbGltaXQYAiABKA0SHwoSYmVmb3JlX3Byb3Bvc2FsX2lkGAMgASgJSACIAQFCFQoTX2JlZm9yZV9wcm9wb3NhbF9pZCKWAQocTGlzdEJvYXJkU3VnZ2VzdGlvbnNSZXNwb25zZRI0Cglwcm9wb3NhbHMYASADKAsyIS5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VnZ2VzdGlvbhIkChduZXh0X2JlZm9yZV9wcm9wb3NhbF9pZBgCIAEoCUgAiAEBQhoKGF9uZXh0X2JlZm9yZV9wcm9wb3NhbF9pZCKfAQodUHJldmlld0JvYXJkU3VnZ2VzdGlvblJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEwoLcHJvcG9zYWxfaWQYAiABKAkSEQoJb3B0aW9uX2lkGAMgASgJEiYKGWV4cGVjdGVkX3Byb3Bvc2FsX3ZlcnNpb24YBCABKARIAIgBAUIcChpfZXhwZWN0ZWRfcHJvcG9zYWxfdmVyc2lvbiL2AQoWQm9hcmRTdWdnZXN0aW9uUHJldmlldxIbCg5ib2FyZF9yZXZpc2lvbhgBIAEoBEgAiAEBEjkKD2NoYW5nZWRfb2JqZWN0cxgCIAMoCzIgLmx1bWluZy5zdHVkaW8udjEuT2JqZWN0TWV0YWRhdGESGgoScmVtb3ZlZF9vYmplY3RfaWRzGAMgAygJEhQKDG9iamVjdF9vcmRlchgEIAMoCRI/ChBjaGFuZ2VkX3BheWxvYWRzGAUgAygLMiUubHVtaW5nLnN0dWRpby52MS5PYmplY3RQYXlsb2FkUmVzdWx0QhEKD19ib2FyZF9yZXZpc2lvbiLZAQoeUHJldmlld0JvYXJkU3VnZ2VzdGlvblJlc3BvbnNlEjsKB3ByZXZpZXcYASABKAsyKC5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkU3VnZ2VzdGlvblByZXZpZXdIABI3Cghjb25mbGljdBgCIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQm9hcmRFZGl0Q29uZmxpY3RIABI3CghyZWplY3RlZBgDIAEoCzIjLmx1bWluZy5zdHVkaW8udjEuQm9hcmRFZGl0UmVqZWN0ZWRIAEIICgZyZXN1bHQisgEKHEFjY2VwdEJvYXJkU3VnZ2VzdGlvblJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEwoLcHJvcG9zYWxfaWQYAiABKAkSEQoJb3B0aW9uX2lkGAMgASgJEiYKGWV4cGVjdGVkX3Byb3Bvc2FsX3ZlcnNpb24YBCABKARIAIgBARISCgpjb21tYW5kX2lkGAUgASgJQhwKGl9leHBlY3RlZF9wcm9wb3NhbF92ZXJzaW9uIlQKHUFjY2VwdEJvYXJkU3VnZ2VzdGlvblJlc3BvbnNlEjMKB3JlY2VpcHQYASABKAsyIi5sdW1pbmcuc3R1ZGlvLnYxLkJvYXJkRWRpdFJlY2VpcHQinwEKHFJlamVjdEJvYXJkU3VnZ2VzdGlvblJlcXVlc3QSEAoIYm9hcmRfaWQYASABKAkSEwoLcHJvcG9zYWxfaWQYAiABKAkSJgoZZXhwZWN0ZWRfcHJvcG9zYWxfdmVyc2lvbhgDIAEoBEgAiAEBEhIKCmNvbW1hbmRfaWQYBCABKAlCHAoaX2V4cGVjdGVkX3Byb3Bvc2FsX3ZlcnNpb24iVgodUmVqZWN0Qm9hcmRTdWdnZXN0aW9uUmVzcG9uc2USNQoKc3VnZ2VzdGlvbhgBIAEoCzIhLmx1bWluZy5zdHVkaW8udjEuQm9hcmRTdWdnZXN0aW9uMvoFChZCb2FyZFN1Z2dlc3Rpb25TZXJ2aWNlEn4KF0NyZWF0ZUJvYXJkUmV2aWV3U291cmNlEjAubHVtaW5nLnN0dWRpby52MS5DcmVhdGVCb2FyZFJldmlld1NvdXJjZVJlcXVlc3QaMS5sdW1pbmcuc3R1ZGlvLnYxLkNyZWF0ZUJvYXJkUmV2aWV3U291cmNlUmVzcG9uc2USeAoVU3VibWl0Qm9hcmRTdWdnZXN0aW9uEi4ubHVtaW5nLnN0dWRpby52MS5TdWJtaXRCb2FyZFN1Z2dlc3Rpb25SZXF1ZXN0Gi8ubHVtaW5nLnN0dWRpby52MS5TdWJtaXRCb2FyZFN1Z2dlc3Rpb25SZXNwb25zZRJ1ChRMaXN0Qm9hcmRTdWdnZXN0aW9ucxItLmx1bWluZy5zdHVkaW8udjEuTGlzdEJvYXJkU3VnZ2VzdGlvbnNSZXF1ZXN0Gi4ubHVtaW5nLnN0dWRpby52MS5MaXN0Qm9hcmRTdWdnZXN0aW9uc1Jlc3BvbnNlEnsKFlByZXZpZXdCb2FyZFN1Z2dlc3Rpb24SLy5sdW1pbmcuc3R1ZGlvLnYxLlByZXZpZXdCb2FyZFN1Z2dlc3Rpb25SZXF1ZXN0GjAubHVtaW5nLnN0dWRpby52MS5QcmV2aWV3Qm9hcmRTdWdnZXN0aW9uUmVzcG9uc2USeAoVQWNjZXB0Qm9hcmRTdWdnZXN0aW9uEi4ubHVtaW5nLnN0dWRpby52MS5BY2NlcHRCb2FyZFN1Z2dlc3Rpb25SZXF1ZXN0Gi8ubHVtaW5nLnN0dWRpby52MS5BY2NlcHRCb2FyZFN1Z2dlc3Rpb25SZXNwb25zZRJ4ChVSZWplY3RCb2FyZFN1Z2dlc3Rpb24SLi5sdW1pbmcuc3R1ZGlvLnYxLlJlamVjdEJvYXJkU3VnZ2VzdGlvblJlcXVlc3QaLy5sdW1pbmcuc3R1ZGlvLnYxLlJlamVjdEJvYXJkU3VnZ2VzdGlvblJlc3BvbnNlYgZwcm90bzM", [file_luming_studio_v1_whiteboard_edits, file_luming_studio_v1_whiteboard_scene, file_luming_studio_v1_whiteboard_service]);
var BoardSuggestionService = /* @__PURE__ */ serviceDesc(file_luming_studio_v1_board_suggestion_service, 0);

// src/entrypoints/http/suggestion-routes.ts
var {
  createBoardReviewSource,
  submitBoardSuggestion,
  listBoardSuggestions,
  previewBoardSuggestion,
  acceptBoardSuggestion,
  rejectBoardSuggestion
} = BoardSuggestionService.method;
var { editBoardGeometry: editBoardGeometry2, editObjectContent: editObjectContent2 } = BoardEditService.method;
var boardSuggestionSubmitPath = "/" + BoardSuggestionService.typeName + "/" + submitBoardSuggestion.name;
function reviewActor(actor) {
  return { id: actor.id, kind: actor.kind ?? "human" };
}
function readOrigin({ origin }) {
  switch (origin.case) {
    case "selection":
      return { kind: "selection", objectIds: origin.value.objectIds.map(requireId) };
    case "feedbackThreadId":
      return { kind: "feedback", threadId: requireId(origin.value) };
    case void 0:
      throw new HttpRequestError(400, "An attached suggestion origin is required.");
  }
}
function toSource(source) {
  return {
    boardId: source.boardId,
    sourceId: source.sourceId,
    capturedBoardRevision: source.capturedBoardRevision,
    objectIds: [...source.objectIds],
    feedbackThreadId: source.feedbackThreadId,
    targets: source.targets.map((target2) => ({ ...target2 })),
    targetsBoardRevision: source.targetsBoardRevision
  };
}
function toSuggestion(suggestion) {
  return { ...suggestion, options: suggestion.options.map((option) => ({ ...option })) };
}
function requireInternalEditIdentity(request) {
  if (request.boardId || request.commandId) {
    throw new HttpRequestError(
      400,
      "A suggestion edit cannot set its own board or command identity."
    );
  }
}
function encodeEdit({ edit }) {
  switch (edit.case) {
    case "geometry": {
      requireInternalEditIdentity(edit.value);
      return { kind: edit.case, bytes: toBinary(editBoardGeometry2.input, edit.value) };
    }
    case "content": {
      requireInternalEditIdentity(edit.value);
      return { kind: edit.case, bytes: toBinary(editObjectContent2.input, edit.value) };
    }
    case void 0:
      throw new HttpRequestError(400, "A typed suggestion edit is required.");
  }
}
function decodeEdit(edit) {
  if (edit.kind === "geometry") {
    const request2 = decodeRequest(editBoardGeometry2.input, edit.bytes);
    requireInternalEditIdentity(request2);
    return { kind: edit.kind, operation: readGeometryOperation(request2) };
  }
  const request = decodeRequest(editObjectContent2.input, edit.bytes);
  requireInternalEditIdentity(request);
  return { kind: edit.kind, operation: readContentOperation(request) };
}
function readOption(value, digest2) {
  const edit = encodeEdit(value);
  return {
    optionId: requireId(value.optionId),
    label: value.label,
    description: value.description,
    edit,
    editFingerprint: edit.kind + ":" + digest2(edit.bytes)
  };
}
function compareVersion(value) {
  if (value === void 0) {
    throw new HttpRequestError(400, "An expected suggestion version is required.");
  }
  return value;
}
function toPreview(boardId, commandId, { decision, boardRevision }) {
  if (decision.kind === "changes") {
    return {
      result: {
        case: "preview",
        value: {
          boardRevision,
          changedObjects: decision.objects?.map(toObjectMetadata),
          changedPayloads: decision.payloads?.map(
            (payload) => toPayloadResult({ kind: "payload", payload })
          ),
          removedObjectIds: decision.removedObjectIds && [...decision.removedObjectIds],
          objectOrder: decision.order && [...decision.order]
        }
      }
    };
  }
  const { outcome } = toBoardEditReceipt({ boardId, commandId, outcome: decision });
  if (outcome?.case === "conflict" || outcome?.case === "rejected") {
    return { result: outcome };
  }
  throw new Error("A preview decision returned the wrong outcome.");
}
function listLimit(limit) {
  if (limit > 50) {
    throw new HttpRequestError(400, "Suggest at most fifty proposals per page.");
  }
  return limit || 30;
}
function createBoardSuggestionRoutes(application, digest2, observe) {
  return [
    unaryRoute(createBoardReviewSource, (actor, request) => ({
      source: toSource(
        application.createSource(reviewActor(actor), {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          expectedBoardRevision: request.expectedBoardRevision,
          origin: readOrigin(request),
          signature: "suggestion-source:" + digest2(toBinary(createBoardReviewSource.input, request))
        })
      )
    })),
    unaryRoute(submitBoardSuggestion, (actor, request) => ({
      suggestion: toSuggestion(
        application.submit(
          reviewActor(actor),
          {
            boardId: requireId(request.boardId),
            commandId: requireId(request.commandId),
            sourceId: requireId(request.sourceId),
            observation: request.observation,
            options: request.options.map((option) => readOption(option, digest2)),
            signature: "suggestion-submit:" + digest2(toBinary(submitBoardSuggestion.input, request))
          },
          decodeEdit
        )
      )
    })),
    unaryRoute(listBoardSuggestions, (actor, { boardId, limit, beforeProposalId }) => {
      const result = application.list(reviewActor(actor), {
        boardId: requireId(boardId),
        limit: listLimit(limit),
        beforeProposalId: beforeProposalId && requireId(beforeProposalId)
      });
      return {
        proposals: result.proposals.map(toSuggestion),
        nextBeforeProposalId: result.nextBeforeProposalId
      };
    }),
    unaryRoute(previewBoardSuggestion, (actor, request) => {
      const { boardId, proposalId, optionId, expectedProposalVersion } = request;
      const preview = application.preview(
        reviewActor(actor),
        {
          boardId: requireId(boardId),
          proposalId: requireId(proposalId),
          optionId: requireId(optionId),
          expectedProposalVersion: compareVersion(expectedProposalVersion)
        },
        decodeEdit
      );
      return toPreview(boardId, proposalId, preview);
    }),
    unaryRoute(acceptBoardSuggestion, (actor, request) => {
      const { boardId, commandId, proposalId, optionId, expectedProposalVersion } = request;
      const receipt = application.accept(
        reviewActor(actor),
        {
          boardId: requireId(boardId),
          commandId: requireId(commandId),
          proposalId: requireId(proposalId),
          optionId: requireId(optionId),
          expectedProposalVersion: compareVersion(expectedProposalVersion),
          signature: "suggestion-accept:" + digest2(toBinary(acceptBoardSuggestion.input, request))
        },
        decodeEdit
      );
      observe?.(receipt);
      return { receipt: toBoardEditReceipt(receipt) };
    }),
    unaryRoute(rejectBoardSuggestion, (actor, request) => ({
      suggestion: toSuggestion(
        application.reject(reviewActor(actor), {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          proposalId: requireId(request.proposalId),
          expectedProposalVersion: compareVersion(request.expectedProposalVersion),
          signature: "suggestion-reject:" + digest2(toBinary(rejectBoardSuggestion.input, request))
        })
      )
    }))
  ];
}

// src/entrypoints/http/guest-web.ts
import {
  createServer
} from "node:http";
var loopback = "127.0.0.1";
var originProtocol = "http://";
async function sendAsset(read, path2, request, response) {
  const asset = await read(path2);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": asset.contentType,
    "content-length": asset.bytes.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  }).end(request.method === "HEAD" ? void 0 : asset.bytes);
}
function listener(read, guest, onError) {
  return (request, response) => {
    response.setHeader("referrer-policy", "no-referrer");
    const path2 = request.url?.split("?", 1)[0] ?? "/";
    const asset = path2 === "/" || path2.startsWith("/assets/");
    const readable = request.method === "GET" || request.method === "HEAD";
    if (asset && readable) {
      sendAsset(read, path2, request, response).catch((error) => {
        onError?.(error);
        response.writeHead(500).end();
      });
      return;
    }
    guest(request, response);
  };
}
async function startGuestListener(options, scope2) {
  const host = scope2 === "local" ? loopback : options.lanHost();
  const port = scope2 === "lan" ? options.lanPort ?? 0 : 0;
  const read = await options.loadAssets();
  const listenerState = {};
  const guest = options.createHandler(scope2, () => listenerState.origin);
  const server = createServer(listener(read, guest, options.onError));
  await new Promise((resolve, reject2) => {
    server.once("error", reject2);
    server.listen(port, host, () => {
      server.removeListener("error", reject2);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Studio sharing did not get an HTTP address.");
  }
  const hostname = address.family === "IPv6" ? "[" + address.address + "]" : address.address;
  const origin = originProtocol + hostname + ":" + address.port;
  listenerState.origin = origin;
  function close() {
    return new Promise((resolve, reject2) => {
      server.close((error) => {
        if (error) {
          reject2(error);
        } else {
          resolve();
        }
      });
      server.closeAllConnections();
    });
  }
  return { origin, close };
}
function createGuestWeb(options) {
  const starts = /* @__PURE__ */ new Map();
  const available = /* @__PURE__ */ new Map();
  let closing = false;
  let shutdown2;
  async function activate(scope2) {
    if (closing) {
      throw new Error("Studio is shutting down.");
    }
    const starting = starts.get(scope2) ?? startGuestListener(options, scope2);
    starts.set(scope2, starting);
    try {
      const listener2 = await starting;
      if (!closing) {
        available.set(scope2, listener2);
      }
    } catch (error) {
      if (starts.get(scope2) === starting) {
        starts.delete(scope2);
      }
      throw error;
    }
  }
  async function closeListeners() {
    closing = true;
    const started = await Promise.allSettled(starts.values());
    starts.clear();
    available.clear();
    const listeners = started.filter((entry) => entry.status === "fulfilled");
    await Promise.all(listeners.map(({ value }) => value.close()));
  }
  function close() {
    shutdown2 ??= closeListeners();
    return shutdown2;
  }
  return { activate, origin: (scope2) => available.get(scope2)?.origin, close };
}

// src/entrypoints/http/model-suggestion.ts
var maximumSuggestionBytes = 128 * 1024;
var maximumReplyBytes = 32 * 1024;
var submission = BoardSuggestionService.method.submitBoardSuggestion;

// src/entrypoints/http/index.ts
var REQUEST_METHOD = "POST";
async function handleRequest(request, response, routes, {
  archiveApplication,
  features,
  resolveActor,
  onError,
  agentSuggestionPath
}) {
  const path2 = request.url ?? "";
  const rooms = features?.rooms;
  if (rooms && roomEventPath(path2)) {
    serveRoomEvents(
      rooms,
      request,
      response,
      () => {
        const actor2 = resolveActor(request);
        return actor2?.kind === "agent" ? void 0 : actor2;
      },
      onError
    );
    return;
  }
  const route2 = routes.get(path2);
  const rawRoute = archiveRoute(path2, archiveApplication);
  if (!route2 && !rawRoute) {
    sendStatus(response, 404);
    return;
  }
  const method = rawRoute?.method ?? REQUEST_METHOD;
  if (request.method !== method) {
    response.setHeader("allow", method);
    sendStatus(response, 405);
    return;
  }
  const actor = resolveActor(request);
  if (!actor) {
    sendStatus(response, 401);
    return;
  }
  if (actor.kind === "agent" && path2 !== agentSuggestionPath) {
    sendStatus(response, 403);
    return;
  }
  if (rawRoute) {
    await rawRoute.run(actor, request, response);
    return;
  }
  if (mediaType(request) !== protobufContentType) {
    sendStatus(response, 415);
    return;
  }
  if (route2) {
    const limit = path2 === boardImageRoutePath ? boardImageRequestLimit : void 0;
    sendProtobuf(response, await route2(actor, await readBody(request, limit)));
  }
}
function handleError(response, error, onError) {
  const canRespond = !response.destroyed && !response.headersSent;
  const invalidRequest = error instanceof CatalogQueryError || error instanceof ArchiveRequestError || error instanceof FeedbackQueryError;
  const routeError = error instanceof HttpRequestError || error instanceof BoardSuggestionError;
  if (routeError || invalidRequest || error instanceof RoomInputError) {
    if (canRespond) {
      sendStatus(response, routeError ? error.status : 400);
    }
    return;
  }
  const forbidden = error instanceof WhiteboardAccessError || error instanceof FeedbackAccessError;
  if (forbidden || error instanceof SharingAccessError || error instanceof RoomAccessError) {
    if (canRespond) {
      sendStatus(response, 403);
    }
    return;
  }
  if (error instanceof RoomCapacityError) {
    if (canRespond) {
      sendStatus(response, 503);
    }
    return;
  }
  if (error instanceof FeedbackThreadNotFoundError) {
    if (canRespond) {
      sendStatus(response, 404);
    }
    return;
  }
  if (canRespond) {
    sendStatus(response, 500);
  }
  onError(error);
}
async function handleGuestRequest(request, response, routes, options, guest) {
  const { sharing } = options;
  if (!sharing) {
    sendStatus(response, 404);
    return;
  }
  if (!allowsGuestOrigin(request, guest)) {
    sendStatus(response, 403);
    return;
  }
  const path2 = request.url ?? "";
  if (isGuestInvitationPath(path2)) {
    await handleGuestInvitation(request, response, sharing, guest);
    return;
  }
  const access = guestAccessForPath(path2);
  if (!access) {
    sendStatus(response, 404);
    return;
  }
  await handleRequest(request, response, routes, {
    ...options,
    resolveActor: (incoming) => resolveGuestActor(incoming, sharing, guest, access)
  });
}
function createWhiteboardRequestHandler(options, guest) {
  const { application, catalogApplication, archiveApplication, features, sharing, onError } = options;
  const observe = observeRoomChange(features?.rooms, onError);
  const studioRoutes = features ? [
    ...createBoardEditRoutes(features.editor, features.digest, observe),
    ...createBoardHistoryRoutes(features.history, features.digest, observe),
    ...createFeedbackRoutes(features.feedback),
    ...features.rooms ? createRoomRoutes(features.rooms) : [],
    ...features.suggestions ? createBoardSuggestionRoutes(features.suggestions, features.digest, observe) : []
  ] : [];
  const routes = new Map([
    ...createWhiteboardRoutes(application, observe),
    ...studioRoutes,
    ...createCatalogRoutes(catalogApplication),
    createArchiveReceiptRoute(archiveApplication),
    ...sharing ? createSharingRoutes(sharing) : []
  ]);
  return (request, response) => {
    const pending = guest ? handleGuestRequest(request, response, routes, options, guest) : handleRequest(request, response, routes, options);
    pending.catch((error) => handleError(response, error, onError));
  };
}
function createWhiteboardHttpServer(options) {
  return createServer2(createWhiteboardRequestHandler(options));
}

// src/infrastructure/platform/index.ts
import { DatabaseSync } from "node:sqlite";

// src/infrastructure/platform/guest-web-assets.ts
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, join as join2 } from "node:path";
var assetTypes = /* @__PURE__ */ new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);
async function loadGuestWebAssets(directory) {
  const root = await realpath(directory);
  const index = join2(root, "index.html");
  if (!(await lstat(index)).isFile()) {
    throw new Error("The Studio Web entry must be a regular file.");
  }
  const bundled = join2(root, "assets");
  if (!(await lstat(bundled)).isDirectory()) {
    throw new Error("The Studio Web asset directory must be a regular directory.");
  }
  const files = /* @__PURE__ */ new Map([["/", { path: index, contentType: "text/html; charset=utf-8" }]]);
  for (const file of await readdir(bundled, { withFileTypes: true })) {
    const contentType = assetTypes.get(extname(file.name));
    if (file.isFile() && contentType) {
      files.set("/assets/" + file.name, { path: join2(bundled, file.name), contentType });
    }
  }
  return async (pathname) => {
    const file = files.get(pathname);
    if (!file || !(await lstat(file.path)).isFile()) {
      return void 0;
    }
    const bytes = await readFile(file.path);
    const body = pathname === "/" ? Buffer.from(
      bytes.toString("utf8").replace(/<html(?=[\s>])/iu, '<html data-studio-guest-entry="true"')
    ) : bytes;
    return { contentType: file.contentType, bytes: body };
  };
}

// src/infrastructure/platform/mcp-runtime.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);

// src/infrastructure/platform/index.ts
function rollback(connection, error) {
  if (!connection.isTransaction) {
    throw error;
  }
  try {
    connection.exec("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [error, rollbackError],
      "Failed to roll back the SQLite transaction.",
      {
        cause: rollbackError
      }
    );
  }
  throw error;
}
function transaction(connection, begin, work) {
  connection.exec(begin);
  try {
    const result = work(connection);
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    return rollback(connection, error);
  }
}
function openSqliteDatabase(filename) {
  const connection = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
  return {
    read: (work) => transaction(connection, "BEGIN", work),
    write: (work) => transaction(connection, "BEGIN IMMEDIATE", work),
    close: () => connection.close()
  };
}

// src/bootstrap/index.ts
import { createHash as createHash2, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

// src/infrastructure/platform/archives/archive-read-error.ts
var ArchiveReadError = class extends Error {
  constructor(code, message, options, signature) {
    super(message, options);
    this.code = code;
    this.signature = signature;
    this.name = "ArchiveReadError";
  }
  code;
  signature;
};
function invalidArchive(message, options) {
  return new ArchiveReadError("invalidArchive", message, options);
}
function archiveTooLarge() {
  return new ArchiveReadError("tooLarge", "Archive exceeds its size or record limits");
}

// src/infrastructure/platform/archives/current-archive.ts
import { Buffer as Buffer6 } from "node:buffer";
import { createHash } from "node:crypto";
import { closeSync, createReadStream as createReadStream2, openSync, readFileSync, readSync } from "node:fs";
import { mkdtemp, readFile as readFile2, realpath as realpath2, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join as join4 } from "node:path";

// src/infrastructure/platform/archives/archive-values.ts
import { Buffer as Buffer4 } from "node:buffer";
var MAX_DEPTH = 64;
var MAX_VALUE_NODES = 1e6;
var MAX_TEXT_BYTES = 16 * 1024 * 1024;
function archiveRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidArchive("Expected an archive record");
  }
  return value;
}
function archiveArray(value) {
  if (!Array.isArray(value)) {
    throw invalidArchive("Expected an archive sequence");
  }
  return value;
}
function archiveIndex(value, count) {
  const integer = typeof value === "number" && Number.isSafeInteger(value);
  if (!integer || value < 0 || value >= count) {
    throw invalidArchive("Invalid archive record reference");
  }
  return value;
}
function archiveFields(value) {
  const fields = /* @__PURE__ */ new Map();
  for (const entry of archiveArray(value)) {
    const pair = archiveArray(entry);
    const [name, element] = pair;
    if (pair.length !== 2 || typeof name !== "string" || fields.has(name)) {
      throw invalidArchive("Invalid or duplicate archive field");
    }
    fields.set(name, element);
  }
  return fields;
}
function primitive(value) {
  const scalar = value === null || typeof value === "string" || typeof value === "boolean";
  return scalar || typeof value === "number" && Number.isFinite(value);
}
function reserve(budget, bytes) {
  budget.bytes += bytes;
  budget.nodes++;
  if (budget.bytes > budget.maximum || budget.nodes > MAX_VALUE_NODES) {
    throw archiveTooLarge();
  }
}
function jsonBytes(value) {
  return Buffer4.byteLength(JSON.stringify(value));
}
var ArchiveValueReader = class {
  constructor(texts, payloads) {
    this.texts = texts;
    this.payloads = payloads;
  }
  texts;
  payloads;
  textByIndex = /* @__PURE__ */ new Map();
  text(reference) {
    const index = archiveIndex(reference, this.texts.length);
    const cached = this.textByIndex.get(index);
    if (cached) {
      return cached;
    }
    const value = this.texts[index];
    if (typeof value !== "string") {
      throw invalidArchive("Invalid archive text reference");
    }
    if (Buffer4.byteLength(value) > MAX_TEXT_BYTES) {
      throw archiveTooLarge();
    }
    const text2 = { value, bytes: jsonBytes(value) };
    this.textByIndex.set(index, text2);
    return text2;
  }
  object(value, budget, depth) {
    const fields = archiveFields(value);
    reserve(budget, 2 + Math.max(0, fields.size - 1));
    const entries = [];
    for (const [key, element] of fields) {
      reserve(budget, jsonBytes(key) + 1);
      entries.push([key, this.value(element, budget, depth + 1)]);
    }
    return Object.fromEntries(entries);
  }
  value(encoded, budget, depth) {
    if (depth > MAX_DEPTH) {
      throw archiveTooLarge();
    }
    if (primitive(encoded)) {
      reserve(budget, jsonBytes(encoded));
      return encoded;
    }
    const wrapped = archiveRecord(encoded);
    const keys = Object.keys(wrapped);
    if (keys.length !== 1) {
      throw invalidArchive("Invalid archive value wrapper");
    }
    if (Object.hasOwn(wrapped, "text")) {
      const text2 = this.text(wrapped.text);
      reserve(budget, text2.bytes);
      return text2.value;
    }
    if (Object.hasOwn(wrapped, "array")) {
      const elements = archiveArray(wrapped.array);
      reserve(budget, 2 + Math.max(0, elements.length - 1));
      return elements.map((element) => this.value(element, budget, depth + 1));
    }
    if (Object.hasOwn(wrapped, "object")) {
      return this.object(wrapped.object, budget, depth);
    }
    throw invalidArchive("Invalid archive value type");
  }
  payload(reference, budget) {
    const index = archiveIndex(reference, this.payloads.length);
    return this.value(this.payloads[index], budget, 0);
  }
};

// src/infrastructure/platform/archives/archive-state.ts
var MAX_ARCHIVE_STATE_BYTES = 64 * 1024 * 1024;
var DELTA_CODEC_VERSION = 2;
var MAX_HISTORY = 200;
var MAX_PROPERTIES = 64;
var MAX_UNITS = 4e3;
var MAX_JSON_DEPTH = 204;
var MAX_JSON_STRUCTURE = 2e6;
var MAX_BOARD_BYTES = 16 * 1024 * 1024;
function textChunk(utf82, chunk) {
  try {
    return utf82.decode(chunk, { stream: chunk !== void 0 });
  } catch (error) {
    throw invalidArchive("Invalid archive state text encoding", { cause: error });
  }
}
async function* stateLines(chunks) {
  const utf82 = new TextDecoder("utf-8", { fatal: true });
  let fragments = [];
  for await (const chunk of chunks) {
    const lines = textChunk(utf82, chunk).split("\n");
    for (const piece of lines.slice(0, -1)) {
      fragments.push(piece);
      yield fragments.join("");
      fragments = [];
    }
    const tail = lines.at(-1);
    if (tail) {
      fragments.push(tail);
    }
  }
  if (textChunk(utf82) || fragments.length) {
    throw invalidArchive("Archive ends within a state record");
  }
}
function jsonStructure(source) {
  let depth = 0;
  let count = 0;
  let insideString = false;
  for (let index = 0; index < source.length; index++) {
    const token2 = source[index];
    if (insideString) {
      if (token2 === "\\") {
        index++;
      } else if (token2 === '"') {
        insideString = false;
      }
      continue;
    }
    if (token2 === '"') {
      insideString = true;
    } else if (token2 === "{" || token2 === "[") {
      depth++;
      count++;
    } else if (token2 === "}" || token2 === "]") {
      depth--;
    } else if (token2 === ",") {
      count++;
    }
    if (depth > MAX_JSON_DEPTH || count > MAX_JSON_STRUCTURE) {
      throw archiveTooLarge();
    }
  }
  return count + 1;
}
var StateRecordReader = class {
  constructor(lines) {
    this.lines = lines;
  }
  lines;
  structure = 0;
  async read() {
    const line = await this.lines.next();
    if (line.done) {
      throw invalidArchive("Archive state is missing a record");
    }
    this.structure += jsonStructure(line.value);
    if (this.structure > MAX_JSON_STRUCTURE) {
      throw archiveTooLarge();
    }
    try {
      return JSON.parse(line.value);
    } catch (error) {
      throw invalidArchive("Invalid archive state JSON", { cause: error });
    }
  }
  async section(length, maximum) {
    const count = archiveIndex(length, maximum + 1);
    const values = [];
    for (let index = 0; index < count; index++) {
      values.push(await this.read());
    }
    return values;
  }
};
function restoreUnits(encoded, prior, payloadCount) {
  const base = prior[archiveIndex(encoded.base, prior.length)];
  if (!base || typeof base === "number") {
    throw invalidArchive("Archive delta has an invalid base");
  }
  const length = archiveIndex(encoded.length, MAX_UNITS + 1);
  const changes = archiveArray(encoded.changes);
  if (changes.length > length) {
    throw invalidArchive("Archive delta contains too many changes");
  }
  const restored = Array.from({ length }, (_, ordinal) => base.units[ordinal]);
  let previousOrdinal = -1;
  for (const change of changes) {
    const pair = archiveArray(change);
    const ordinal = archiveIndex(pair[0], length);
    if (pair.length !== 2 || previousOrdinal >= ordinal) {
      throw invalidArchive("Archive delta changes are out of order");
    }
    restored[ordinal] = archiveIndex(pair[1], payloadCount);
    previousOrdinal = ordinal;
  }
  return restored.map((reference) => archiveIndex(reference, payloadCount));
}
function restoreContent(encoded, prior, payloadCount) {
  if (typeof encoded === "number") {
    return archiveIndex(encoded, payloadCount);
  }
  const entry = archiveRecord(encoded);
  const fields = archiveIndex(entry.fields, payloadCount);
  if (Object.hasOwn(entry, "base")) {
    if (Object.keys(entry).length !== 4) {
      throw invalidArchive("Invalid archive delta record");
    }
    return { fields, units: restoreUnits(entry, prior, payloadCount) };
  }
  if (Object.keys(entry).length !== 2) {
    throw invalidArchive("Invalid archive content record");
  }
  const units = archiveArray(entry.units);
  if (units.length > MAX_UNITS) {
    throw archiveTooLarge();
  }
  return { fields, units: units.map((id) => archiveIndex(id, payloadCount)) };
}
function checkHistory(value, contentCount, payloadCount) {
  const history = archiveArray(value);
  if (history.length > MAX_HISTORY) {
    throw archiveTooLarge();
  }
  for (const version of history) {
    const references = archiveArray(version);
    if (references.length !== 3) {
      throw invalidArchive("Invalid archive history references");
    }
    archiveIndex(references[0], payloadCount);
    archiveIndex(references[1], payloadCount);
    archiveIndex(references[2], contentCount);
  }
}
function latestObjects(value, reader2) {
  const budget = { maximum: MAX_BOARD_BYTES, bytes: 0, nodes: 0 };
  if (typeof value === "number") {
    const content = archiveRecord(reader2.payload(value, budget));
    const elements = archiveArray(content.elements);
    if (elements.length > MAX_UNITS) {
      throw archiveTooLarge();
    }
    return elements;
  }
  const fields = archiveRecord(reader2.payload(value.fields, budget));
  if (Object.hasOwn(fields, "elements")) {
    throw invalidArchive("Duplicate archive object list");
  }
  return value.units.map((reference) => reader2.payload(reference, budget));
}
function projectState(header, contents, reader2, artifactId) {
  const properties = archiveFields(header.properties);
  if (properties.size > MAX_PROPERTIES) {
    throw archiveTooLarge();
  }
  const budget = { maximum: MAX_ARCHIVE_STATE_BYTES, bytes: 0, nodes: 0 };
  const board = archiveRecord(reader2.payload(properties.get("artifact"), budget));
  const { title } = board;
  if (board.id !== artifactId) {
    throw invalidArchive("Archive manifest does not match the board identifier");
  }
  if (board.type !== "whiteboard") {
    throw new ArchiveReadError("incompatibleContent", "Archive does not contain a whiteboard");
  }
  if (typeof title !== "string" || !title.trim()) {
    throw invalidArchive("Archive board title is missing");
  }
  const current = contents[archiveIndex(header.current, contents.length)];
  if (current === void 0) {
    throw invalidArchive("Archive contains no current board");
  }
  const assets = archiveRecord(reader2.payload(properties.get("assets"), budget));
  return { title, objects: latestObjects(current, reader2), assets };
}
async function readSections(records, lines, artifactId) {
  const header = archiveRecord(await records.read());
  const lengths = archiveArray(header.lengths);
  if (header.version !== DELTA_CODEC_VERSION || lengths.length !== 3) {
    throw invalidArchive("Invalid archive state header");
  }
  const texts = await records.section(lengths[0], MAX_JSON_STRUCTURE);
  const payloads = await records.section(lengths[1], MAX_JSON_STRUCTURE);
  const encodedContents = await records.section(lengths[2], MAX_HISTORY + 1);
  if (!(await lines.next()).done) {
    throw invalidArchive("Archive contains extra state records");
  }
  const contents = [];
  for (const value of encodedContents) {
    contents.push(restoreContent(value, contents, payloads.length));
  }
  checkHistory(header.history, contents.length, payloads.length);
  return projectState(header, contents, new ArchiveValueReader(texts, payloads), artifactId);
}
async function readCurrentArchiveState(chunks, artifactId) {
  const lines = stateLines(chunks);
  try {
    return await readSections(new StateRecordReader(lines), lines, artifactId);
  } finally {
    await lines.return(void 0);
  }
}

// src/infrastructure/platform/archives/zip-reader.ts
import { Buffer as Buffer5 } from "node:buffer";
import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { join as join3 } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";
var MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
var MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
var MAX_ARCHIVE_ENTRIES = 5e3;
var CENTRAL_END_LENGTH = 22;
var CENTRAL_HEADER_LENGTH = 46;
var LOCAL_HEADER_LENGTH = 30;
var MAX_ENTRY_NAME_LENGTH = 128;
var MAX_ZIP_COMMENT = 65535;
var DESCRIPTOR_FLAG = 8;
var ENCRYPTED_FLAG = 1;
var STORE = 0;
var DEFLATE = 8;
var CENTRAL_END = 101010256;
var CENTRAL_FILE = 33639248;
var LOCAL_FILE = 67324752;
var DATA_DESCRIPTOR = 134695760;
var utf8 = new TextDecoder("utf-8", { fatal: true });
var pathSegment2 = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;
var deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
var ZipExtractionError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    this.name = "ZipExtractionError";
  }
  code;
};
function invalidZip(message = "Invalid ZIP archive", options) {
  return new ZipExtractionError("invalidArchive", message, options);
}
function tooLargeZip() {
  return new ZipExtractionError("tooLarge", "ZIP exceeds its extraction limits");
}
function invalidPathSegment(segment) {
  return !pathSegment2.test(segment) || deviceName.test(segment);
}
function requireEntryLimit(name, limitForName) {
  const path2 = name.endsWith("/") ? name.slice(0, -1) : name;
  if (path2.split("/").some(invalidPathSegment)) {
    throw invalidZip("Invalid ZIP entry name");
  }
  const limit = limitForName(name);
  if (limit === void 0) {
    throw invalidZip("ZIP entry is not allowed");
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("Expected a nonnegative ZIP entry limit");
  }
  return limit;
}
async function readBytes(file, size, offset) {
  const buffer = Buffer5.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const block = await file.read(buffer, read, size - read, offset + read);
    if (!block.bytesRead) {
      throw invalidZip();
    }
    read += block.bytesRead;
  }
  return buffer;
}
async function locateDirectory(file) {
  const size = (await file.stat()).size;
  if (size > MAX_ARCHIVE_BYTES) {
    throw tooLargeZip();
  }
  const length = Math.min(size, CENTRAL_END_LENGTH + MAX_ZIP_COMMENT);
  const tail = await readBytes(file, length, size - length);
  for (let index = length - CENTRAL_END_LENGTH; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== CENTRAL_END) {
      continue;
    }
    const recordLength = CENTRAL_END_LENGTH + tail.readUInt16LE(index + 20);
    if (index + recordLength !== length) {
      continue;
    }
    const count = tail.readUInt16LE(index + 10);
    const onDisk = tail.readUInt16LE(index + 8);
    const diskNumbers = tail.readUInt32LE(index + 4);
    if (count !== onDisk || diskNumbers !== 0) {
      throw invalidZip("Invalid ZIP directory");
    }
    const offset = tail.readUInt32LE(index + 16);
    const end = size - length + index;
    if (offset + tail.readUInt32LE(index + 12) !== end) {
      throw invalidZip("Invalid ZIP directory");
    }
    if (count > MAX_ARCHIVE_ENTRIES) {
      throw tooLargeZip();
    }
    return { count, offset, end };
  }
  throw invalidZip("Invalid ZIP directory");
}
function entryName(bytes) {
  try {
    return utf8.decode(bytes);
  } catch (error) {
    throw invalidZip("Invalid ZIP entry name encoding", { cause: error });
  }
}
async function centralEntry(file, cursor, end, limitForName) {
  if (cursor + CENTRAL_HEADER_LENGTH > end) {
    throw invalidZip();
  }
  const raw = await readBytes(file, CENTRAL_HEADER_LENGTH, cursor);
  const nameLength = raw.readUInt16LE(28);
  const nameOffset = cursor + CENTRAL_HEADER_LENGTH;
  const next = nameOffset + nameLength + raw.readUInt16LE(30) + raw.readUInt16LE(32);
  if (raw.readUInt32LE(0) !== CENTRAL_FILE || next > end || raw.readUInt16LE(34) !== 0) {
    throw invalidZip();
  }
  if (!nameLength || nameLength > MAX_ENTRY_NAME_LENGTH) {
    throw invalidZip("Invalid ZIP entry name");
  }
  const name = entryName(await readBytes(file, nameLength, nameOffset));
  const limit = requireEntryLimit(name, limitForName);
  const size = raw.readUInt32LE(24);
  const compressed = raw.readUInt32LE(20);
  const encoding = raw.readUInt16LE(10);
  if (size > limit || compressed > MAX_ARCHIVE_BYTES || ![STORE, DEFLATE].includes(encoding)) {
    throw tooLargeZip();
  }
  const flags = raw.readUInt16LE(8);
  if (flags & ENCRYPTED_FLAG) {
    throw invalidZip("Encrypted ZIP entries are unsupported");
  }
  return {
    entry: {
      name,
      size,
      compressed,
      encoding,
      flags,
      limit,
      checksum: raw.readUInt32LE(16),
      offset: raw.readUInt32LE(42)
    },
    next
  };
}
function fileSizesMatch(raw, offset, entry) {
  return raw.readUInt32LE(offset) === entry.checksum && raw.readUInt32LE(offset + 4) === entry.compressed && raw.readUInt32LE(offset + 8) === entry.size;
}
async function localEntry(file, entry, next) {
  const { offset } = entry;
  if (offset + LOCAL_HEADER_LENGTH > next) {
    throw invalidZip();
  }
  const raw = await readBytes(file, LOCAL_HEADER_LENGTH, offset);
  if (raw.readUInt32LE(0) !== LOCAL_FILE || raw.readUInt16LE(6) !== entry.flags) {
    throw invalidZip();
  }
  if (raw.readUInt16LE(8) !== entry.encoding || raw.readUInt16LE(26) !== entry.name.length) {
    throw invalidZip();
  }
  const name = await readBytes(file, entry.name.length, offset + LOCAL_HEADER_LENGTH);
  if (entryName(name) !== entry.name) {
    throw invalidZip();
  }
  const dataOffset = offset + LOCAL_HEADER_LENGTH + name.length + raw.readUInt16LE(28);
  const dataEnd = dataOffset + entry.compressed;
  const trailer = next - dataEnd;
  if (entry.flags & DESCRIPTOR_FLAG) {
    if (trailer !== 12 && trailer !== 16) {
      throw invalidZip();
    }
    const descriptor = await readBytes(file, trailer, dataEnd);
    const sizesOffset = trailer - 12;
    const badSignature = sizesOffset && descriptor.readUInt32LE(0) !== DATA_DESCRIPTOR;
    if (badSignature || !fileSizesMatch(descriptor, sizesOffset, entry)) {
      throw invalidZip();
    }
  } else if (trailer || !fileSizesMatch(raw, 14, entry)) {
    throw invalidZip();
  }
  return { ...entry, dataOffset };
}
async function readEntries(archive, limitForName) {
  const file = await open(archive, "r");
  try {
    const directory = await locateDirectory(file);
    const names = /* @__PURE__ */ new Set();
    const entries = [];
    let cursor = directory.offset;
    let expanded = 0;
    for (let index = 0; index < directory.count; index++) {
      const { entry, next } = await centralEntry(file, cursor, directory.end, limitForName);
      const key = entry.name.toLowerCase();
      if (names.has(key)) {
        throw invalidZip("Duplicate ZIP entry");
      }
      names.add(key);
      expanded += entry.size;
      if (expanded > MAX_EXPANDED_BYTES) {
        throw tooLargeZip();
      }
      cursor = next;
      entries.push(entry);
    }
    entries.sort((a, b) => a.offset - b.offset);
    if (cursor !== directory.end || entries[0]?.offset !== 0) {
      throw invalidZip();
    }
    const local = [];
    for (const [index, entry] of entries.entries()) {
      local.push(await localEntry(file, entry, entries[index + 1]?.offset ?? directory.offset));
    }
    return local;
  } finally {
    await file.close();
  }
}
async function inflateEntry(source, bounds, output, compressed) {
  const inflate = createInflateRaw();
  try {
    await pipeline(source, inflate, bounds, output);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : void 0;
    if (typeof code === "string" && code.startsWith("Z_")) {
      throw invalidZip("ZIP entry could not be decompressed", { cause: error });
    }
    throw error;
  }
  if (inflate.bytesWritten !== compressed) {
    throw invalidZip("ZIP entry contains trailing compressed data");
  }
}
async function extractEntry(archive, entry, file) {
  let size = 0;
  let checksum = 0;
  const bounds = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > entry.size || size > entry.limit) {
        done(tooLargeZip());
        return;
      }
      checksum = crc32(chunk, checksum);
      done(null, chunk);
    }
  });
  const source = entry.compressed ? createReadStream(archive, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressed - 1
  }) : Readable.from([]);
  const output = createWriteStream(file, { flags: "wx" });
  if (entry.encoding === DEFLATE) {
    await inflateEntry(source, bounds, output, entry.compressed);
  } else {
    await pipeline(source, bounds, output);
  }
  if (size !== entry.size || checksum !== entry.checksum) {
    throw invalidZip("ZIP entry failed integrity verification");
  }
}
async function extractEntries(archive, directory, entries) {
  const files = /* @__PURE__ */ new Map();
  for (const [index, entry] of entries.entries()) {
    const path2 = join3(directory, "entry-" + index);
    await extractEntry(archive, entry, path2);
    files.set(entry.name, { path: path2, size: entry.size });
  }
  return files;
}
async function extractZipAfterManifest(archive, directory, limitForName, manifest) {
  const entries = await readEntries(
    archive,
    (name) => name === manifest.name ? limitForName(name) : MAX_EXPANDED_BYTES
  );
  const manifestEntry = entries.find((entry) => entry.name === manifest.name);
  if (!manifestEntry) {
    throw invalidZip("ZIP archive is missing its manifest");
  }
  const manifestPath = join3(directory, "manifest-entry");
  await extractEntry(archive, manifestEntry, manifestPath);
  const metadata = await manifest.read({ path: manifestPath, size: manifestEntry.size });
  const payloadEntries = entries.filter((entry) => entry !== manifestEntry);
  for (const entry of payloadEntries) {
    entry.limit = requireEntryLimit(entry.name, limitForName);
    if (entry.size > entry.limit) {
      throw tooLargeZip();
    }
  }
  return { metadata, files: await extractEntries(archive, directory, payloadEntries) };
}

// src/infrastructure/platform/archives/current-archive.ts
var ARCHIVE_FORMAT = "luming-studio-archive";
var ARCHIVE_VERSION = 4;
var MANIFEST = "manifest.json";
var DELTA_STATE = "artifact-deltas.ndjson";
var ASSET_PREFIX = "assets/";
var MAX_MANIFEST_BYTES = 4 * 1024;
var MAX_ASSET_BYTES = 20 * 1024 * 1024;
var RETENTION_CHUNK_BYTES = 1024 * 1024;
var archiveId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
var assetMediaType = /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/u;
function entryLimit(name) {
  if (name === MANIFEST) {
    return MAX_MANIFEST_BYTES;
  }
  if (name === DELTA_STATE) {
    return MAX_ARCHIVE_STATE_BYTES;
  }
  if (name === ASSET_PREFIX) {
    return 0;
  }
  if (name.startsWith(ASSET_PREFIX) && archiveId.test(name.slice(ASSET_PREFIX.length))) {
    return MAX_ASSET_BYTES;
  }
  return void 0;
}
function parseManifest(bytes) {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return archiveRecord(JSON.parse(source));
  } catch (error) {
    throw invalidArchive("Invalid archive manifest", { cause: error });
  }
}
async function readManifest(entry) {
  const manifest = parseManifest(await readFile2(entry.path));
  if (manifest.format !== ARCHIVE_FORMAT || manifest.version !== ARCHIVE_VERSION) {
    throw new ArchiveReadError("unsupportedVersion", "Only Studio ZIP v4 is supported");
  }
  if (manifest.state !== DELTA_STATE || Object.hasOwn(manifest, "database")) {
    throw invalidArchive("Archive manifest must identify the delta state");
  }
  const { artifactId } = manifest;
  if (typeof artifactId !== "string" || !archiveId.test(artifactId)) {
    throw invalidArchive("Archive manifest has an invalid board identifier");
  }
  return artifactId;
}
function selectedAsset(id, entry, metadata) {
  const row = archiveRecord(Object.hasOwn(metadata, id) ? metadata[id] : void 0);
  if (row.id !== id || row.size !== entry.size) {
    throw invalidArchive("Archive asset does not match its declared size or identifier");
  }
  const { mimeType } = row;
  if (typeof mimeType !== "string" || !assetMediaType.test(mimeType)) {
    throw invalidArchive("Archive asset has an invalid media type");
  }
  return { ...entry, mimeType };
}
function archiveAssets(files, metadata) {
  const assets = /* @__PURE__ */ new Map();
  for (const [name, entry] of files) {
    if (!name.startsWith(ASSET_PREFIX) || name === ASSET_PREFIX) {
      continue;
    }
    const id = name.slice(ASSET_PREFIX.length);
    assets.set(id, selectedAsset(id, entry, metadata));
  }
  if (assets.size !== Object.keys(metadata).length) {
    throw invalidArchive("Archive is missing a declared asset");
  }
  return assets;
}
async function writePackedArchive(archivePath, body) {
  const hash = createHash("sha256");
  let bytes = 0;
  async function* boundedChunks() {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        throw invalidArchive("Archive upload must contain binary chunks");
      }
      bytes += chunk.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) {
        throw archiveTooLarge();
      }
      hash.update(chunk);
      yield chunk;
    }
  }
  await writeFile(archivePath, boundedChunks(), { flag: "wx", mode: 384 });
  return hash.digest("hex");
}
async function discardStage(dispose, error) {
  try {
    await dispose();
  } catch (cleanup) {
    throw new AggregateError([error, cleanup], "Failed to discard the archive stage", {
      cause: cleanup
    });
  }
  throw error;
}
function readFailure(error, signature) {
  if (error instanceof ArchiveReadError || error instanceof ZipExtractionError) {
    return new ArchiveReadError(error.code, error.message, { cause: error }, signature);
  }
  return error;
}
async function stageCurrentArchive(chunks) {
  const temporaryRoot = await realpath2(tmpdir());
  const stage = await mkdtemp(join4(temporaryRoot, "luming-ii-archive-"));
  const archivePath = join4(stage, "source.zip");
  function dispose() {
    if (dirname(stage) !== temporaryRoot) {
      throw new Error("Archive stage is outside its temporary directory");
    }
    return rm(stage, { force: true, recursive: true });
  }
  let signature;
  try {
    signature = await writePackedArchive(archivePath, chunks);
    const { metadata: sourceBoardId, files } = await extractZipAfterManifest(
      archivePath,
      stage,
      entryLimit,
      { name: MANIFEST, read: readManifest }
    );
    const stateFile = files.get(DELTA_STATE);
    if (!stateFile) {
      throw invalidArchive("Archive is missing its delta state");
    }
    const state = await readCurrentArchiveState(createReadStream2(stateFile.path), sourceBoardId);
    const assets = archiveAssets(files, state.assets);
    return {
      sourceBoardId,
      title: state.title,
      objects: state.objects,
      assets,
      archivePath,
      signature,
      dispose
    };
  } catch (error) {
    return discardStage(dispose, readFailure(error, signature));
  }
}
function readStagedArchiveEntry(entry) {
  const bytes = readFileSync(entry.path);
  if (bytes.length !== entry.size) {
    throw new Error("Staged archive entry changed before publication");
  }
  return bytes;
}
function* readStagedArchiveChunks(archive) {
  const descriptor = openSync(archive.archivePath, "r");
  try {
    while (true) {
      const buffer = Buffer6.allocUnsafe(RETENTION_CHUNK_BYTES);
      const size = readSync(descriptor, buffer);
      if (!size) {
        return;
      }
      yield buffer.subarray(0, size);
    }
  } finally {
    closeSync(descriptor);
  }
}

// src/infrastructure/adapters/authorization/index.ts
function readFlag(value) {
  if (value !== 0n && value !== 1n) {
    throw new Error("Invalid stored board access flag.");
  }
  return value === 1n;
}
function localAccess(connection, boardId, actorId2) {
  const query = connection.prepare(`
    SELECT m.can_edit, COALESCE(l.owner_actor_id = m.actor_id, 0) AS is_owner
    FROM board_members AS m
    JOIN boards AS b ON b.board_id = m.board_id
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ? AND m.actor_id = ? AND l.trashed_at_millis IS NULL
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, actorId2);
  if (row) {
    const canEdit = readFlag(row.can_edit);
    const isOwner = readFlag(row.is_owner);
    const memberRole = canEdit ? "editor" : "viewer";
    return { canEdit, canComment: canEdit, isOwner, role: isOwner ? "owner" : memberRole };
  }
}
var guestActorId = /^guest-[a-f0-9-]{36}$/u;
function readActiveBoardGuest(connection, boardId, actorId2, now) {
  if (!guestActorId.test(actorId2)) {
    return void 0;
  }
  const query = connection.prepare(`
    SELECT m.role, m.name, s.scope, s.version
    FROM board_sharing_members AS m
    JOIN sharing_browser_sessions AS b ON b.actor_id = m.actor_id
    JOIN board_sharing AS s ON s.board_id = m.board_id AND s.enabled = 1
    JOIN board_sharing_invites AS i
      ON i.board_id = m.board_id AND i.role = m.role AND i.enabled = 1
      AND i.version = m.invitation_version
    LEFT JOIN board_lifecycle AS l ON l.board_id = m.board_id
    WHERE m.board_id = ? AND m.actor_id = ? AND m.removed = 0
      AND l.trashed_at_millis IS NULL
      AND b.expires_at_millis > COALESCE(?, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER))
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, actorId2, now ?? null);
  if (!row) {
    return void 0;
  }
  const { role, name, scope: scope2, version } = row;
  const validRole = role === "editor" || role === "commenter" || role === "viewer";
  const validScope = scope2 === "local" || scope2 === "lan";
  const validMetadata = typeof name === "string" && typeof version === "bigint";
  if (!validRole || !validScope || !validMetadata) {
    throw new Error("Invalid stored guest access.");
  }
  return { role, name, scope: scope2, version };
}
function readBoardAccess(connection, boardId, actorId2) {
  const local = localAccess(connection, boardId, actorId2);
  if (local) {
    return local;
  }
  const guest = readActiveBoardGuest(connection, boardId, actorId2);
  if (guest) {
    const { role, name } = guest;
    return {
      canEdit: role === "editor",
      canComment: role !== "viewer",
      isOwner: false,
      role,
      name
    };
  }
}

// src/infrastructure/adapters/archives/scene-values.ts
var ArchiveObjectError = class extends Error {
};
var assetPath3 = /(?<![\w/:.])\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?![\w./%-])/gu;
function record2(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return value;
}
function sequence(value, name) {
  if (!Array.isArray(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return value;
}
function stringValue2(value, name) {
  if (typeof value !== "string") {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return value;
}
function optionalString2(value, name) {
  return value === void 0 ? void 0 : stringValue2(value, name);
}
function requiredId(value, name) {
  const id = stringValue2(value, name);
  if (!id) {
    throw new ArchiveObjectError(`Missing archived ${name}.`);
  }
  return id;
}
function numberValue(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return value;
}
function optionalNumber(value, name) {
  return value === void 0 ? void 0 : numberValue(value, name);
}
function unsignedInteger(value, name) {
  const integer = numberValue(value, name);
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return integer;
}
function booleanValue(value, name, defaultValue = false) {
  if (value === void 0) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }
  return value;
}
function remapSource(value, name, resolveSource) {
  const source = optionalString2(value, name);
  return source ? resolveSource(source, "reference") : source;
}
function remapMarkup(text2, resolveSource) {
  return text2.replace(assetPath3, (source) => resolveSource(source, "text"));
}
function remapContent(value, resolveSource) {
  if (typeof value === "string") {
    return remapMarkup(value, resolveSource);
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapContent(item, resolveSource));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapContent(item, resolveSource)])
    );
  }
  return value;
}

// src/infrastructure/adapters/archives/scene-geometry.ts
var connectorPorts = /* @__PURE__ */ new Set(["top", "right", "bottom", "left"]);
var connectorHeads = /* @__PURE__ */ new Set(["none", "arrow", "circle"]);
var transparentColors = /* @__PURE__ */ new Set(["transparent", "none"]);
var transparentHex = /^#(?:[\da-f]{3}|[\da-f]{6}0)0$/iu;
var transparentRgba = /^rgba?\(\s*(?:[\d.%]+\s*,\s*){3}0(?:\.0+)?%?\s*\)$/iu;
var transparentRgbAlpha = /^rgba?\(\s*[\d.%]+(?:\s+[\d.%]+){2}\s*\/\s*0(?:\.0+)?%?\s*\)$/iu;
function readGeometry2(element) {
  const width = numberValue(element.w, "object width");
  const height = numberValue(element.h, "object height");
  if (width < 0 || height < 0) {
    throw new ArchiveObjectError("Archived object dimensions cannot be negative.");
  }
  return {
    x: numberValue(element.x, "object x"),
    y: numberValue(element.y, "object y"),
    width,
    height,
    rotation: optionalNumber(element.rotation, "object rotation") ?? 0
  };
}
function appearance(element) {
  const stroke = element.type === "stroke" || element.type === "arrow" ? element.stroke ?? element.color : element.stroke;
  return {
    fill: optionalString2(element.fill, "fill"),
    stroke: optionalString2(stroke, "stroke"),
    strokeWidth: optionalNumber(element.strokeWidth, "stroke width"),
    dashed: booleanValue(element.dash, "dashed stroke"),
    hollow: booleanValue(element.hollow, "hollow object")
  };
}
function endpoint(value, side, fallback, ids) {
  if (typeof value === "string") {
    const port = optionalString2(side, "connector port");
    if (port !== void 0 && !connectorPorts.has(port)) {
      throw new ArchiveObjectError("Invalid archived connector port.");
    }
    return { point: fallback, attachment: ids.has(value) ? { objectId: value, port } : void 0 };
  }
  if (value === void 0) {
    return { point: fallback };
  }
  const coords = sequence(value, "connector endpoint");
  if (coords.length !== 2) {
    throw new ArchiveObjectError("Invalid archived connector endpoint.");
  }
  return {
    point: { x: numberValue(coords[0], "endpoint x"), y: numberValue(coords[1], "endpoint y") }
  };
}
function coordinatePairs(values, field) {
  if (values.length % 2 !== 0) {
    throw new ArchiveObjectError(`Invalid archived ${field} coordinates.`);
  }
  const points = [];
  for (let index = 0; index < values.length; index += 2) {
    points.push({ x: numberValue(values[index], field), y: numberValue(values[index + 1], field) });
  }
  return points;
}
function connectorBends(value) {
  const bends = value === void 0 ? [] : sequence(value, "connector bends");
  const axis = bends[0];
  if (axis === "h" || axis === "v") {
    return {
      bends: [],
      relativeBends: {
        firstAxis: axis === "h" ? "horizontal" : "vertical",
        offsets: bends.slice(1).map((offset) => numberValue(offset, "connector bend offset"))
      }
    };
  }
  return { bends: coordinatePairs(bends, "connector bend") };
}
function heads2(element) {
  if (element.heads === void 0) {
    return {
      startHead: element.head === "both" ? "arrow" : "none",
      endHead: element.head === "none" ? "none" : "arrow"
    };
  }
  const list = sequence(element.heads, "connector heads");
  const startHead = list[0];
  const endHead = list[1];
  if (list.length !== 2 || typeof startHead !== "string" || typeof endHead !== "string") {
    throw new ArchiveObjectError("Invalid archived connector heads.");
  }
  if (!connectorHeads.has(startHead) || !connectorHeads.has(endHead)) {
    throw new ArchiveObjectError("Invalid archived connector heads.");
  }
  return { startHead, endHead };
}
function connectorLabelOffset(value) {
  if (value === void 0) {
    return;
  }
  const offset = record2(value, "connector label offset");
  return { x: numberValue(offset.x, "label x offset"), y: numberValue(offset.y, "label y offset") };
}
function connector(element, geometry, ids) {
  const { x, y, width, height } = geometry;
  return {
    kind: "connector",
    start: endpoint(element.from, element.fromSide, { x, y }, ids),
    end: endpoint(element.to, element.toSide, { x: x + width, y: y + height }, ids),
    ...connectorBends(element.bends),
    labelOffset: connectorLabelOffset(element.labelOffset),
    ...heads2(element)
  };
}
function transparentSection(element) {
  const fill = (optionalString2(element.fill, "section fill") ?? "").trim().toLowerCase();
  const hasNoColor = transparentColors.has(fill) || transparentHex.test(fill);
  const hasNoOpacity = transparentRgba.test(fill) || transparentRgbAlpha.test(fill);
  return element.hollow === true || hasNoColor || hasNoOpacity;
}
function geometryDetail(element, geometry, ids) {
  switch (element.type) {
    case "shape":
      return { kind: "shape", outline: optionalString2(element.kind, "shape outline") ?? "rounded" };
    case "container":
      return { kind: "section", transparent: transparentSection(element) };
    case "arrow":
      return connector(element, geometry, ids);
    case "stroke":
      return {
        kind: "ink",
        width: optionalNumber(element.strokeWidth ?? element.width, "ink width") ?? 3
      };
  }
}
function inkPoints(element, { width, height }) {
  const values = element.points === void 0 ? [] : sequence(element.points, "ink points");
  return coordinatePairs(values, "ink point").map(({ x, y }) => ({
    x: width === 0 ? x : x / width,
    y: height === 0 ? y : y / height
  }));
}

// src/infrastructure/adapters/archives/scene-content.ts
var textAlignments = /* @__PURE__ */ new Map([
  ["left", "TEXT_ALIGNMENT_LEFT"],
  ["center", "TEXT_ALIGNMENT_CENTER"],
  ["right", "TEXT_ALIGNMENT_RIGHT"]
]);
var maximumImageDimension = 4294967295;
function nullableData(value) {
  return value === void 0 ? {} : record2(value, "object data");
}
function textPayload(element, label) {
  return {
    text: label,
    color: optionalString2(element.color, "text color"),
    fontFamily: optionalString2(element.fontFamily, "font family"),
    fontSize: optionalNumber(element.fontSize, "font size"),
    align: textAlignments.get(optionalString2(element.textAlign, "text alignment") ?? "")
  };
}
function documentBlock(value, resolveSource) {
  const block = record2(value, "document block");
  const children = block.children === void 0 ? [] : sequence(block.children, "child blocks");
  const props = block.props === void 0 ? {} : record2(block.props, "document block props");
  return {
    blockId: requiredId(block.id, "document block identifier"),
    type: stringValue2(block.type, "document block type"),
    props: remapContent(props, resolveSource),
    content: remapContent(block.content, resolveSource),
    children: children.map((child) => documentBlock(child, resolveSource))
  };
}
function documentPayload(value, title, resolveSource) {
  const document = record2(value, "document");
  if (document.schemaVersion !== 1) {
    throw new ArchiveObjectError("Invalid archived document schema version.");
  }
  const blocks = sequence(document.blocks, "document blocks");
  return {
    title,
    schemaVersion: 1,
    blocks: blocks.map((block) => documentBlock(block, resolveSource))
  };
}
function todoSource(value, origin) {
  if (value === void 0) {
    return;
  }
  const source = record2(value, "todo source");
  const artifactId = optionalString2(source.artifactId, "todo source board");
  const boardId = origin && artifactId === origin.sourceBoardId ? origin.boardId : artifactId;
  return {
    boardId,
    objectId: requiredId(source.elementId, "todo source object"),
    blockId: optionalString2(source.blockId, "todo source block"),
    itemId: optionalString2(source.itemId, "todo source item"),
    version: source.version === void 0 ? void 0 : unsignedInteger(source.version, "todo source version")
  };
}
function todoPayload(value, title, origin) {
  const data = nullableData(value);
  const items = data.items === void 0 ? [] : sequence(data.items, "todo items");
  return {
    title,
    items: items.map((value2) => {
      const item = record2(value2, "todo item");
      return {
        itemId: requiredId(item.id, "todo item identifier"),
        text: stringValue2(item.text, "todo text"),
        checked: booleanValue(item.checked, "todo checkbox"),
        sourceRef: todoSource(item.sourceRef, origin)
      };
    })
  };
}
function cell(value) {
  if (value === null) {
    return { nullValue: "NULL_VALUE" };
  }
  if (typeof value === "string") {
    return { text: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  return { number: numberValue(value, "table cell") };
}
function tablePayload(value, text2) {
  const table = nullableData(value);
  const rows = table.rows === void 0 ? [] : sequence(table.rows, "table rows");
  const rowIds = table.rowIds === void 0 ? [] : sequence(table.rowIds, "table row identifiers");
  const columnIds = table.columnIds === void 0 ? [] : sequence(table.columnIds, "table column identifiers");
  const widths = table.columnWidths === void 0 ? [] : sequence(table.columnWidths, "table column widths");
  return {
    text: text2,
    grid: {
      rows: rows.map((row) => ({ cells: sequence(row, "table cells").map(cell) })),
      rowIds: rowIds.map((id) => requiredId(id, "table row identifier")),
      columnIds: columnIds.map((id) => requiredId(id, "table column identifier")),
      columnWidths: widths.map((width) => numberValue(width, "table column width")),
      head: table.head === void 0 ? void 0 : booleanValue(table.head, "table header")
    }
  };
}
function naturalSize(value) {
  const data = nullableData(value);
  if (data.naturalWidth === void 0 || data.naturalHeight === void 0) {
    return;
  }
  const width = unsignedInteger(data.naturalWidth, "image natural width");
  const height = unsignedInteger(data.naturalHeight, "image natural height");
  if (width > maximumImageDimension || height > maximumImageDimension) {
    throw new ArchiveObjectError("Archived image dimensions exceed the supported range.");
  }
  return { width, height };
}
function cropValue(value) {
  if (value === void 0) {
    return;
  }
  const crop = record2(value, "image crop");
  return {
    x: numberValue(crop.x, "image crop x"),
    y: numberValue(crop.y, "image crop y"),
    zoom: numberValue(crop.zoom, "image crop zoom")
  };
}
function embedPayload(element, title, resolveSource) {
  const html = optionalString2(element.html, "embed markup");
  return {
    title,
    html: html === void 0 ? void 0 : remapMarkup(html, resolveSource),
    sourceRevision: element.sourceRevision === void 0 ? void 0 : unsignedInteger(element.sourceRevision, "embed source revision"),
    state: remapContent(element.state, resolveSource)
  };
}
function payloadFor(element, context) {
  const { kind, label, geometry, resolveSource, origin } = context;
  switch (kind) {
    case "text":
    case "note":
    case "shape":
    case "section":
      return { bodyKind: "text", data: textPayload(element, label) };
    case "document":
      return {
        bodyKind: "document",
        data: documentPayload(element.document, label, resolveSource)
      };
    case "todo":
      return { bodyKind: "todo", data: todoPayload(element.data, label, origin) };
    case "table":
      return { bodyKind: "table", data: tablePayload(element.data, label) };
    case "html":
    case "diagram":
    case "chart":
      return { bodyKind: "embed", data: embedPayload(element, label, resolveSource) };
    case "image":
      return {
        bodyKind: "image",
        data: {
          src: remapSource(element.src, "image source", resolveSource),
          href: remapSource(element.href, "image link", resolveSource),
          crop: cropValue(element.crop),
          naturalSize: naturalSize(element.data)
        }
      };
    case "video":
      return {
        bodyKind: "video",
        data: {
          src: remapSource(element.video, "video source", resolveSource),
          poster: remapSource(element.src, "video poster", resolveSource)
        }
      };
    case "link":
      return {
        bodyKind: "link",
        data: { href: remapSource(element.href, "link target", resolveSource) }
      };
    case "sticker": {
      const data = nullableData(element.data);
      return {
        bodyKind: "sticker",
        data: { stickerId: optionalString2(data.stickerIconId, "sticker icon"), fallback: label }
      };
    }
    case "ink":
      return { bodyKind: "ink", data: { points: inkPoints(element, geometry) } };
  }
}

// src/infrastructure/adapters/archives/scene.ts
var kinds = /* @__PURE__ */ new Set([
  "shape",
  "text",
  "image",
  "html",
  "document",
  "table",
  "link",
  "note",
  "sticker",
  "diagram",
  "chart",
  "todo"
]);
var renamedKinds = /* @__PURE__ */ new Map([
  ["container", "section"],
  ["stroke", "ink"],
  ["arrow", "connector"]
]);
var objectIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
function sceneKind(element) {
  const type = stringValue2(element.type, "object type");
  if (type === "image" && element.video) {
    return "video";
  }
  const renamed = renamedKinds.get(type);
  if (renamed) {
    return renamed;
  }
  if (!kinds.has(type)) {
    throw new ArchiveObjectError("Unsupported archived object type.");
  }
  return type;
}
function sceneObject(objectId, element, ids, resolveSource, origin) {
  const kind = sceneKind(element);
  const text2 = kind === "connector" ? element.label : element.text;
  const label = optionalString2(text2, "object label") ?? "";
  const geometry = readGeometry2(element);
  return {
    objectId,
    kind,
    label,
    ...geometry,
    locked: booleanValue(element.locked, "object lock"),
    parentId: optionalString2(element.parentId, "parent identifier"),
    groupId: optionalString2(element.groupId, "group identifier"),
    appearance: appearance(element),
    detail: geometryDetail(element, geometry, ids),
    payload: payloadFor(element, { geometry, kind, label, resolveSource, origin })
  };
}
function prepareArchiveObjects(values, resolveSource, origin) {
  const ids = /* @__PURE__ */ new Set();
  const objectsById = values.map((value) => {
    const element = record2(value, "object");
    const id = requiredId(element.id, "object identifier");
    if (!objectIdentifier.test(id)) {
      throw new ArchiveObjectError("Invalid archived object identifier.");
    }
    if (ids.has(id)) {
      throw new ArchiveObjectError("Duplicate archived object identifier.");
    }
    ids.add(id);
    return { id, element };
  });
  return objectsById.map(({ id, element }) => sceneObject(id, element, ids, resolveSource, origin));
}

// src/infrastructure/adapters/archives/publication.ts
var webMediaTypes = /* @__PURE__ */ new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm"
]);
function preparePublication(archive, boardId) {
  const prefix = `/assets/${archive.sourceBoardId}/`;
  const assetIds = /* @__PURE__ */ new Set();
  function resolveSource(source, kind) {
    if (!source.startsWith("/assets/")) {
      return source;
    }
    const assetId = source.slice(prefix.length);
    if (!source.startsWith(prefix) || !archive.assets.has(assetId)) {
      if (kind === "text") {
        return source;
      }
      throw new ArchiveObjectError("The board refers to an asset absent from its archive.");
    }
    assetIds.add(assetId);
    return `/studio-archive-assets/${boardId}/${assetId}`;
  }
  const objects = prepareArchiveObjects(archive.objects, resolveSource, {
    sourceBoardId: archive.sourceBoardId,
    boardId
  });
  return { objects, assetIds };
}
function writeBoard(connection, command, title) {
  const { actorId: actorId2, boardId, updatedAtMillis } = command;
  connection.prepare("INSERT INTO boards (board_id, title, revision) VALUES (?, ?, 0)").run(boardId, title);
  connection.prepare("INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)").run(boardId, actorId2);
  connection.prepare(`
      INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
      VALUES (?, ?, 0, 0)
    `).run(boardId, updatedAtMillis);
}
function writeScene(connection, boardId, objects) {
  const insertObject = connection.prepare(`
    INSERT INTO board_objects (
      board_id, object_id, kind, label, layer_index, x, y, width, height, rotation,
      geometry_version, locked, parent_id, group_id, appearance_json, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `);
  const insertPayload = connection.prepare(`
    INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
    VALUES (?, ?, 0, ?, ?)
  `);
  for (const [layerIndex, object] of objects.entries()) {
    insertObject.run(
      boardId,
      object.objectId,
      object.kind,
      object.label,
      layerIndex,
      object.x,
      object.y,
      object.width,
      object.height,
      object.rotation,
      Number(object.locked),
      object.parentId ?? null,
      object.groupId ?? null,
      object.appearance ? JSON.stringify(object.appearance) : null,
      object.detail ? JSON.stringify(object.detail) : null
    );
    if (object.payload) {
      insertPayload.run(
        boardId,
        object.objectId,
        object.payload.bodyKind,
        JSON.stringify(object.payload.data)
      );
    }
  }
}
function publicMimeType(value) {
  const lower = value.trim().toLowerCase();
  return webMediaTypes.has(lower) ? lower : "application/octet-stream";
}
function writeAssets(connection, boardId, archive, assetIds) {
  const insert = connection.prepare(`
    INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) VALUES (?, ?, ?, ?)
  `);
  for (const [assetId, entry] of archive.assets) {
    if (assetIds.has(assetId)) {
      insert.run(boardId, assetId, publicMimeType(entry.mimeType), readStagedArchiveEntry(entry));
    }
  }
}
function retainSource(connection, boardId, archive) {
  const insert = connection.prepare(`
    INSERT INTO board_archive_source_chunks (board_id, chunk_index, bytes) VALUES (?, ?, ?)
  `);
  let chunkIndex = 0;
  for (const bytes of readStagedArchiveChunks(archive)) {
    insert.run(boardId, chunkIndex, bytes);
    chunkIndex += 1;
  }
}
function writePublication(connection, command, archive, publication) {
  const { boardId } = command;
  writeBoard(connection, command, archive.title);
  writeScene(connection, boardId, publication.objects);
  writeAssets(connection, boardId, archive, publication.assetIds);
  retainSource(connection, boardId, archive);
}
function readPublishedAsset(connection, actorId2, boardId, assetId) {
  if (!readBoardAccess(connection, boardId, actorId2)) {
    return void 0;
  }
  const row = connection.prepare(`
    SELECT mime_type, bytes FROM board_archive_assets
    WHERE board_id = ? AND asset_id = ?
  `).get(boardId, assetId);
  if (!row) {
    return void 0;
  }
  const { mime_type: mimeType, bytes } = row;
  if (typeof mimeType !== "string" || !(bytes instanceof Uint8Array)) {
    throw new Error("Invalid published asset data.");
  }
  return { mimeType: publicMimeType(mimeType), bytes };
}

// src/infrastructure/adapters/archives/schema.ts
var archiveSchema = `
  CREATE TABLE IF NOT EXISTS archive_import_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    board_id TEXT,
    title TEXT,
    rejection_reason TEXT,
    CHECK (
      (board_id IS NOT NULL AND title IS NOT NULL AND rejection_reason IS NULL) OR
      (board_id IS NULL AND title IS NULL AND rejection_reason IS NOT NULL)
    ),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_archive_assets (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (board_id, asset_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_archive_source_chunks (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    bytes BLOB NOT NULL,
    PRIMARY KEY (board_id, chunk_index)
  ) STRICT;
`;

// src/infrastructure/adapters/archives/index.ts
var rejectionReasons = /* @__PURE__ */ new Set([
  "invalidArchive",
  "unsupportedVersion",
  "incompatibleContent",
  "commandIdReuse",
  "tooLarge"
]);
function rejected4(commandId, reason) {
  return { commandId, outcome: { kind: "rejected", reason } };
}
function isRejectionReason(value) {
  return rejectionReasons.has(value);
}
function readReceipt(connection, actorId2, commandId) {
  const row = connection.prepare(`
    SELECT signature, board_id, title, rejection_reason
    FROM archive_import_receipts
    WHERE actor_id = ? AND command_id = ?
  `).get(actorId2, commandId);
  if (!row) {
    return void 0;
  }
  const { signature, board_id: boardId, title, rejection_reason: reason } = row;
  if (typeof signature !== "string") {
    throw new Error("Invalid archive import signature.");
  }
  if (typeof boardId === "string" && typeof title === "string") {
    return { signature, receipt: { commandId, outcome: { kind: "imported", boardId, title } } };
  }
  if (!isRejectionReason(reason)) {
    throw new Error("Invalid archive import rejection.");
  }
  return { signature, receipt: rejected4(commandId, reason) };
}
function writeReceipt3(connection, actorId2, signature, receipt) {
  const { commandId, outcome } = receipt;
  const imported = outcome.kind === "imported" ? outcome : void 0;
  const reason = outcome.kind === "rejected" ? outcome.reason : null;
  connection.prepare(`
    INSERT INTO archive_import_receipts (
      actor_id, command_id, signature, board_id, title, rejection_reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(actorId2, commandId, signature, imported?.boardId ?? null, imported?.title ?? null, reason);
  return receipt;
}
function replayReceipt(connection, command, signature) {
  const existing = readReceipt(connection, command.actorId, command.commandId);
  if (!existing) {
    return void 0;
  }
  return existing.signature === signature ? existing.receipt : rejected4(command.commandId, "commandIdReuse");
}
function publishArchive(connection, command, archive) {
  const { actorId: actorId2, boardId, commandId } = command;
  const { signature, title } = archive;
  const replay = replayReceipt(connection, command, signature);
  if (replay) {
    return replay;
  }
  let publication;
  try {
    publication = preparePublication(archive, boardId);
  } catch (error) {
    if (!(error instanceof ArchiveObjectError)) {
      throw error;
    }
    return writeReceipt3(connection, actorId2, signature, rejected4(commandId, "incompatibleContent"));
  }
  writePublication(connection, command, archive, publication);
  return writeReceipt3(connection, actorId2, signature, {
    commandId,
    outcome: { kind: "imported", boardId, title }
  });
}
function recordReadRejection(database, command, error) {
  const { signature } = error;
  const receipt = rejected4(command.commandId, error.code);
  if (signature === void 0) {
    return receipt;
  }
  return database.write(
    (connection) => replayReceipt(connection, command, signature) ?? writeReceipt3(connection, command.actorId, signature, receipt)
  );
}
async function importCurrent(database, command) {
  let archive;
  try {
    archive = await stageCurrentArchive(command.chunks);
  } catch (error) {
    if (!(error instanceof ArchiveReadError)) {
      throw error;
    }
    return recordReadRejection(database, command, error);
  }
  try {
    return database.write((connection) => publishArchive(connection, command, archive));
  } finally {
    await archive.dispose();
  }
}
function createArchiveImportRepository(database) {
  database.write((connection) => connection.exec(archiveSchema));
  return {
    importCurrent: (command) => importCurrent(database, command),
    getReceipt: (actorId2, commandId) => database.read((connection) => readReceipt(connection, actorId2, commandId)?.receipt),
    getAsset: (actorId2, boardId, assetId) => database.read((connection) => readPublishedAsset(connection, actorId2, boardId, assetId))
  };
}

// src/infrastructure/adapters/catalog/copy-asset-markup.ts
var tokens = /<!--[\s\S]*?-->|(<(script|style)\b(?:"[^"]*"|'[^']*'|[^'"<>])*>)([\s\S]*?)(<\/\2\s*>)|<[a-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>/giu;
var attributes = /(\s+)([^\s=/"'<>\x60]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>\x60]+)/gu;
var cssTokens = /\/\*[\s\S]*?\*\/|(\burl\(\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s"'()]+)(\s*\))|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/giu;
var scriptTokens = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60/gu;
var standalonePath = /^([([{'"“‘]*)(\/studio-archive-assets\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})([.,!?;:'")\]}”’。，；：、…]*)$/u;
var urlAttributes = /* @__PURE__ */ new Set(["src", "href", "poster", "data", "background", "xlink:href"]);
var quoted = /* @__PURE__ */ new Set(['"', "'", "`"]);
function mapAttributeValue(value, replace) {
  const quote = value[0];
  if (quote === void 0 || !quoted.has(quote)) {
    return replace(value);
  }
  return quote + replace(value.slice(1, -1)) + quote;
}
function rewriteCss(css, replace) {
  return css.replace(
    cssTokens,
    (token2, opening, value, closing) => opening === void 0 ? token2 : opening + mapAttributeValue(value, replace) + closing
  );
}
function rewriteLiteralScript(script, replace) {
  return script.replace(scriptTokens, (token2) => {
    if (token2.startsWith("/")) {
      return token2;
    }
    return mapAttributeValue(token2, replace);
  });
}
function rewriteSourceSet(list, replace) {
  return list.replace(/\S+/gu, (part) => {
    const uri = part.replace(/,+$/u, "");
    return replace(uri) + part.slice(uri.length);
  });
}
function rewriteAttribute(name, token2, replace) {
  const field = name.toLowerCase();
  if (urlAttributes.has(field)) {
    return mapAttributeValue(token2, replace);
  }
  if (field === "style") {
    return mapAttributeValue(token2, (css) => rewriteCss(css, replace));
  }
  if (field === "srcset") {
    return mapAttributeValue(token2, (list) => rewriteSourceSet(list, replace));
  }
  return token2;
}
function rewriteTag(tag, replace) {
  return tag.replace(
    attributes,
    (_token, space, name, equals, value) => space + name + equals + rewriteAttribute(name, value, replace)
  );
}
function rewriteCopyMarkup(markup, replace) {
  return markup.replace(
    tokens,
    (token2, opening, rawTag, content, closing) => {
      if (rawTag !== void 0) {
        const newContent = rawTag.toLowerCase() === "style" ? rewriteCss(content, replace) : rewriteLiteralScript(content, replace);
        return rewriteTag(opening, replace) + newContent + closing;
      }
      return token2.startsWith("<!--") ? token2 : rewriteTag(token2, replace);
    }
  );
}
function rewriteCopyText(text2, replace) {
  return text2.replace(/\S+/gu, (part) => {
    const match = standalonePath.exec(part);
    if (!match) {
      return part;
    }
    const [, opening = "", uri = "", closing = ""] = match;
    return opening + replace(uri) + closing;
  });
}

// src/infrastructure/adapters/catalog/duplicate-payload.ts
var assetPath4 = /^\/studio-archive-assets\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/u;
var CopyPayloadError = class extends Error {
  constructor() {
    super("The source board contains an unreadable payload.");
  }
};
function record3(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  return value;
}
function replaceField(body, field, replace) {
  const value = body[field];
  if (typeof value === "string") {
    body[field] = replace(value);
  }
}
function rewriteDocument(body, replace) {
  const rewriteText = (text2) => rewriteCopyText(text2, replace);
  const pending = [body.blocks];
  while (pending.length) {
    const children = pending.pop();
    if (!Array.isArray(children)) {
      continue;
    }
    for (const value of children) {
      const block = record3(value);
      if (!block) {
        continue;
      }
      if ("props" in block) {
        block.props = rewriteState(block.props, rewriteText);
      }
      if ("content" in block) {
        block.content = rewriteState(block.content, rewriteText);
      }
      pending.push(block.children);
    }
  }
}
function rewriteState(value, replace) {
  if (typeof value === "string") {
    return replace(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteState(entry, replace));
  }
  const fields = record3(value);
  if (!fields) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(fields).map(([field, entry]) => [field, rewriteState(entry, replace)])
  );
}
function rewriteEmbed(body, replace) {
  replaceField(body, "html", (markup) => rewriteCopyMarkup(markup, replace));
  if ("state" in body) {
    body.state = rewriteState(body.state, (text2) => rewriteCopyText(text2, replace));
  }
}
function rebindTodoSource(source, scope2) {
  if (typeof source.objectId !== "string" || !source.objectId) {
    return false;
  }
  const { boardId } = source;
  const explicitSource = boardId === scope2.sourceBoardId;
  if (boardId !== void 0 && !explicitSource) {
    return false;
  }
  if (explicitSource) {
    source.boardId = scope2.destinationBoardId;
  }
  const hadVersion = "version" in source;
  if (hadVersion) {
    delete source.version;
  }
  return explicitSource || hadVersion;
}
function rewriteTodo(body, scope2) {
  if (!Array.isArray(body.items)) {
    return false;
  }
  let changed = false;
  for (const value of body.items) {
    const source = record3(record3(value)?.sourceRef);
    if (source && rebindTodoSource(source, scope2)) {
      changed = true;
    }
  }
  return changed;
}
function rewriteAssets(bodyKind, body, replace) {
  switch (bodyKind) {
    case "image":
      replaceField(body, "src", replace);
      replaceField(body, "href", replace);
      break;
    case "video":
      replaceField(body, "src", replace);
      replaceField(body, "poster", replace);
      break;
    case "link":
      replaceField(body, "href", replace);
      break;
    case "document":
      rewriteDocument(body, replace);
      break;
    case "embed":
      rewriteEmbed(body, replace);
      break;
  }
}
function rewriteCopyPayload(bodyKind, bodyJson, scope2) {
  const parsed = JSON.parse(bodyJson);
  const body = record3(parsed);
  if (!body) {
    throw new CopyPayloadError();
  }
  let changed = false;
  const replace = (source) => {
    const match = assetPath4.exec(source);
    if (!match) {
      return source;
    }
    const [, boardId, assetId] = match;
    if (boardId !== scope2.sourceBoardId || assetId === void 0) {
      return source;
    }
    scope2.onAsset(assetId);
    changed = true;
    return "/studio-archive-assets/" + scope2.destinationBoardId + "/" + assetId;
  };
  if (bodyKind === "todo") {
    changed = rewriteTodo(body, scope2);
  } else {
    rewriteAssets(bodyKind, body, replace);
  }
  return changed ? JSON.stringify(body) : void 0;
}

// src/infrastructure/adapters/catalog/duplicate-board.ts
var maximumCopiedPayloadBytes = 32n * 1024n * 1024n;
function payloadSize(connection, boardId) {
  const query = connection.prepare(
    "SELECT COALESCE(SUM(length(CAST(body_json AS BLOB))), 0) AS bytes FROM object_payloads WHERE board_id = ?"
  );
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (typeof row?.bytes !== "bigint") {
    throw new Error("The source board payload size is unavailable.");
  }
  return row.bytes;
}
function payloadText(row, key) {
  const value = row[key];
  if (typeof value !== "string") {
    throw new CopyPayloadError();
  }
  return value;
}
function inspectCopy(connection, sourceBoardId, destinationBoardId) {
  if (payloadSize(connection, sourceBoardId) > maximumCopiedPayloadBytes) {
    return "invalidCommand";
  }
  const assetIds = /* @__PURE__ */ new Set();
  const changedPayloadIds = [];
  const scope2 = {
    sourceBoardId,
    destinationBoardId,
    onAsset(assetId) {
      assetIds.add(assetId);
    }
  };
  const candidates = connection.prepare(
    "SELECT object_id, body_kind, body_json FROM object_payloads WHERE board_id = ? AND body_kind IN ('image', 'video', 'link', 'document', 'embed', 'todo')"
  );
  try {
    for (const row of candidates.iterate(sourceBoardId)) {
      const kind = payloadText(row, "body_kind");
      const json = payloadText(row, "body_json");
      if (rewriteCopyPayload(kind, json, scope2) !== void 0) {
        changedPayloadIds.push(payloadText(row, "object_id"));
      }
    }
  } catch (error) {
    if (error instanceof CopyPayloadError) {
      return "stateChanged";
    }
    throw error;
  }
  const present = connection.prepare(
    "SELECT 1 FROM board_archive_assets WHERE board_id = ? AND asset_id = ?"
  );
  for (const id of assetIds) {
    if (present.get(sourceBoardId, id) === void 0) {
      return "stateChanged";
    }
  }
  return { scope: scope2, changedPayloadIds, assetIds: [...assetIds] };
}
function copyCurrentScene(connection, scope2) {
  const { sourceBoardId, destinationBoardId } = scope2;
  connection.prepare(
    "INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height, rotation, geometry_version, locked, parent_id, group_id, appearance_json, detail_json) SELECT ?, object_id, kind, label, layer_index, x, y, width, height, rotation, 0, locked, parent_id, group_id, appearance_json, detail_json FROM board_objects WHERE board_id = ?"
  ).run(destinationBoardId, sourceBoardId);
  connection.prepare(
    "INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json) SELECT ?, object_id, 0, body_kind, body_json FROM object_payloads WHERE board_id = ?"
  ).run(destinationBoardId, sourceBoardId);
}
function applyPayloadRewrites(connection, plan) {
  const { scope: scope2, changedPayloadIds } = plan;
  const source = connection.prepare(
    "SELECT body_kind, body_json FROM object_payloads WHERE board_id = ? AND object_id = ?"
  );
  const update2 = connection.prepare(
    "UPDATE object_payloads SET body_json = ? WHERE board_id = ? AND object_id = ?"
  );
  for (const objectId of changedPayloadIds) {
    const row = source.get(scope2.sourceBoardId, objectId);
    if (!row) {
      throw new Error("The source board payload disappeared during copying.");
    }
    const body = rewriteCopyPayload(
      payloadText(row, "body_kind"),
      payloadText(row, "body_json"),
      scope2
    );
    if (body === void 0) {
      throw new Error("The source board payload changed during copying.");
    }
    update2.run(body, scope2.destinationBoardId, objectId);
  }
}
function copyAssets(connection, plan) {
  const { assetIds, scope: scope2 } = plan;
  if (!assetIds.length) {
    return;
  }
  const result = connection.prepare(
    "INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) SELECT ?, a.asset_id, a.mime_type, a.bytes FROM board_archive_assets AS a JOIN json_each(?) AS requested ON requested.value = a.asset_id WHERE a.board_id = ?"
  ).run(scope2.destinationBoardId, JSON.stringify(assetIds), scope2.sourceBoardId);
  if (Number(result.changes) !== assetIds.length) {
    throw new Error("Some source board assets disappeared during copying.");
  }
}
function duplicateBoard2(connection, sourceBoardId, destinationBoardId, publish) {
  const plan = inspectCopy(connection, sourceBoardId, destinationBoardId);
  if (typeof plan === "string") {
    return plan;
  }
  publish();
  copyCurrentScene(connection, plan.scope);
  applyPayloadRewrites(connection, plan);
  copyAssets(connection, plan);
  return void 0;
}

// src/infrastructure/adapters/catalog/management-receipts.ts
function text(value) {
  if (typeof value !== "string") {
    throw new Error("Invalid stored catalog receipt text.");
  }
  return value;
}
function record4(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid stored catalog receipt object.");
  }
  return value;
}
function unsigned(value) {
  const decoded = BigInt(text(value));
  if (decoded < 0n) {
    throw new Error("Invalid stored catalog receipt version.");
  }
  return decoded;
}
function readBoard(value) {
  const { boardId, title, updatedAtMillis, pinned, entryVersion, canManage } = record4(value);
  if (typeof pinned !== "boolean" || typeof canManage !== "boolean") {
    throw new Error("Invalid stored catalog receipt flags.");
  }
  return {
    boardId: text(boardId),
    title: text(title),
    updatedAtMillis: updatedAtMillis === void 0 ? void 0 : unsigned(updatedAtMillis),
    pinned,
    entryVersion: unsigned(entryVersion),
    canManage
  };
}
function readReason(value) {
  switch (value) {
    case "invalidTitle":
    case "commandIdReuse":
    case "forbidden":
    case "entryVersionChanged":
    case "stateChanged":
    case "invalidCommand":
      return value;
    default:
      throw new Error("Invalid stored catalog rejection reason.");
  }
}
function readReceipt2(json) {
  const decoded = JSON.parse(json);
  const value = record4(decoded);
  const commandId = text(value.commandId);
  switch (value.kind) {
    case "changed":
      return { kind: "changed", commandId, board: readBoard(value.board) };
    case "purged": {
      if (!Array.isArray(value.items)) {
        throw new Error("Invalid stored catalog purge items.");
      }
      return { kind: "purged", commandId, items: value.items.map(readPurgeItem) };
    }
    case "rejected":
      return { kind: "rejected", commandId, reason: readReason(value.reason) };
    default:
      throw new Error("Invalid stored catalog receipt kind.");
  }
}
function readPurgeItem(value) {
  const item = record4(value);
  const boardId = text(item.boardId);
  if (typeof item.deleted !== "boolean") {
    throw new Error("Invalid stored catalog purge result.");
  }
  return item.deleted ? { boardId, deleted: true } : { boardId, deleted: false, reason: readReason(item.reason) };
}
function getManagementReceipt(connection, actorId2, commandId) {
  const row = connection.prepare(`
      SELECT signature, receipt_json
      FROM catalog_management_receipts
      WHERE actor_id = ? AND command_id = ?
    `).get(actorId2, commandId);
  return row && { signature: text(row.signature), receipt: readReceipt2(text(row.receipt_json)) };
}
function saveManagementReceipt(connection, actorId2, signature, receipt) {
  const json = JSON.stringify(
    receipt,
    (_, value) => typeof value === "bigint" ? value.toString() : value
  );
  connection.prepare(`
      INSERT INTO catalog_management_receipts (actor_id, command_id, signature, receipt_json)
      VALUES (?, ?, ?, ?)
    `).run(actorId2, receipt.commandId, signature, json);
}

// src/infrastructure/adapters/catalog/schema.ts
var catalogSchema = `
  CREATE TABLE IF NOT EXISTS catalog_entries (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    entry_version INTEGER NOT NULL CHECK (entry_version >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_create_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    title TEXT NOT NULL,
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    entry_version INTEGER NOT NULL CHECK (entry_version >= 0),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_management_receipts (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (actor_id, command_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_duplicate_sources (
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    source_board_id TEXT NOT NULL,
    PRIMARY KEY (actor_id, command_id),
    FOREIGN KEY (actor_id, command_id)
      REFERENCES catalog_create_receipts (actor_id, command_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS catalog_members_by_actor
    ON board_members (actor_id, board_id);

  CREATE TRIGGER IF NOT EXISTS catalog_record_created_owner
  AFTER INSERT ON catalog_create_receipts
  BEGIN
    INSERT INTO board_lifecycle (board_id, owner_actor_id)
    VALUES (NEW.board_id, NEW.actor_id);
  END;

  CREATE TRIGGER IF NOT EXISTS catalog_record_imported_owner
  AFTER INSERT ON archive_import_receipts
  WHEN NEW.board_id IS NOT NULL
  BEGIN
    INSERT INTO board_lifecycle (board_id, owner_actor_id)
    VALUES (NEW.board_id, NEW.actor_id);
  END;

  CREATE TRIGGER IF NOT EXISTS catalog_track_board_edit
  AFTER UPDATE OF revision ON boards
  WHEN NEW.revision > OLD.revision
  BEGIN
    INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
    VALUES (NEW.board_id, CAST(ROUND(unixepoch('subsec') * 1000) AS INTEGER), 0, 0)
    ON CONFLICT (board_id) DO UPDATE SET updated_at_millis =
      MAX(catalog_entries.updated_at_millis, excluded.updated_at_millis);
  END;

  WITH provenance AS (
    SELECT board_id, actor_id FROM catalog_create_receipts
    UNION
    SELECT board_id, actor_id FROM archive_import_receipts WHERE board_id IS NOT NULL
  ), confirmed_owner AS (
    SELECT board_id, MIN(actor_id) AS actor_id
    FROM provenance
    GROUP BY board_id
    HAVING COUNT(*) = 1
  )
  INSERT INTO board_lifecycle (board_id, owner_actor_id)
  SELECT owner.board_id, owner.actor_id
  FROM confirmed_owner AS owner
  JOIN board_members AS member ON member.board_id = owner.board_id AND member.actor_id = owner.actor_id
  WHERE NOT EXISTS (SELECT 1 FROM board_lifecycle AS lifecycle WHERE lifecycle.board_id = owner.board_id);
`;

// src/infrastructure/adapters/catalog/index.ts
var catalogOrderings = {
  recent: {
    columns: "-pinned, -COALESCE(updated_at_millis, -1), board_id",
    parameters: "-?, -COALESCE(?, -1), ?",
    values: ({ pinned, updatedAtMillis, boardId }) => [
      Number(pinned),
      updatedAtMillis ?? null,
      boardId
    ]
  },
  title: {
    columns: "-pinned, lower(title), board_id",
    parameters: "-?, lower(?), ?",
    values: ({ pinned, title, boardId }) => [Number(pinned), title, boardId]
  }
};
var trashOrderings = {
  recent: {
    columns: "-trashed_at_millis, board_id",
    parameters: "-?, ?",
    values: ({ trashedAtMillis, boardId }) => [trashedAtMillis ?? null, boardId]
  },
  title: {
    columns: "lower(title), board_id",
    parameters: "lower(?), ?",
    values: ({ title, boardId }) => [title, boardId]
  }
};
var catalogColumns = `
  b.board_id, b.title, c.updated_at_millis,
  COALESCE(c.pinned, 0) AS pinned,
  COALESCE(c.entry_version, 0) AS entry_version,
  COALESCE(l.owner_actor_id = m.actor_id, 0) AS can_manage,
  l.trashed_at_millis
`;
var catalogTables = `
  FROM board_members AS m
  JOIN boards AS b ON b.board_id = m.board_id
  LEFT JOIN catalog_entries AS c ON c.board_id = b.board_id
  LEFT JOIN board_lifecycle AS l ON l.board_id = b.board_id
`;
var activeBoards = "l.trashed_at_millis IS NULL";
var ownedTrash = "l.owner_actor_id = m.actor_id AND l.trashed_at_millis IS NOT NULL";
function readUnsigned(value, fieldName) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`Invalid catalog integer for ${fieldName}.`);
  }
  return value;
}
function readSummary(row) {
  const {
    board_id: boardId,
    title,
    updated_at_millis: updatedAtMillis,
    pinned,
    entry_version: entryVersion,
    can_manage: canManage
  } = row;
  if (typeof boardId !== "string" || typeof title !== "string") {
    throw new Error("Invalid catalog board identity.");
  }
  if (pinned !== 0n && pinned !== 1n) {
    throw new Error("Invalid catalog pin state.");
  }
  if (canManage !== 0n && canManage !== 1n) {
    throw new Error("Invalid catalog management permission.");
  }
  return {
    boardId,
    title,
    updatedAtMillis: updatedAtMillis === null ? void 0 : readUnsigned(updatedAtMillis, "updated_at_millis"),
    pinned: pinned === 1n,
    entryVersion: readUnsigned(entryVersion, "entry_version"),
    canManage: canManage === 1n
  };
}
function listRows(connection, lookup, condition, ordering) {
  const { actorId: actorId2, query, limit, after } = lookup;
  const boundary = after ? `WHERE (${ordering.columns}) > (${ordering.parameters})` : "";
  const values = after ? ordering.values(after) : [];
  const statement = connection.prepare(`
    WITH visible AS (
      SELECT ${catalogColumns}
      ${catalogTables}
      WHERE m.actor_id = ? AND instr(lower(b.title), lower(?)) > 0 AND ${condition}
    )
    SELECT board_id, title, updated_at_millis, pinned, entry_version, can_manage, trashed_at_millis
    FROM visible
    ${boundary}
    ORDER BY ${ordering.columns}
    LIMIT ?
  `);
  statement.setReadBigInts(true);
  return statement.all(actorId2, query, ...values, limit);
}
function listBoards2(connection, lookup) {
  return listRows(connection, lookup, activeBoards, catalogOrderings[lookup.order]).map(
    readSummary
  );
}
function listTrashedBoards2(connection, lookup) {
  return listRows(connection, lookup, ownedTrash, trashOrderings[lookup.order]).map((row) => ({
    board: readSummary(row),
    trashedAtMillis: readUnsigned(row.trashed_at_millis, "trashed_at_millis")
  }));
}
function getCreatedReceipt(connection, actorId2, commandId) {
  const statement = connection.prepare(`
    SELECT c.board_id, c.title, c.updated_at_millis, c.pinned, c.entry_version,
      1 AS can_manage, d.source_board_id
    FROM catalog_create_receipts AS c
    LEFT JOIN catalog_duplicate_sources AS d
      ON d.actor_id = c.actor_id AND d.command_id = c.command_id
    WHERE c.actor_id = ? AND c.command_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(actorId2, commandId);
  if (!row) {
    return void 0;
  }
  const { source_board_id: sourceBoardId } = row;
  if (sourceBoardId !== null && typeof sourceBoardId !== "string") {
    throw new Error("Invalid stored catalogue duplicate source.");
  }
  return {
    receipt: { kind: "created", commandId, board: readSummary(row) },
    duplicateSourceId: sourceBoardId ?? void 0
  };
}
function getReceipt(connection, actorId2, commandId) {
  return getCreatedReceipt(connection, actorId2, commandId) ?? getManagementReceipt(connection, actorId2, commandId);
}
function getManagedBoard(connection, actorId2, boardId) {
  const statement = connection.prepare(`
    SELECT ${catalogColumns}
    ${catalogTables}
    WHERE m.actor_id = ? AND b.board_id = ? AND l.owner_actor_id = m.actor_id
  `);
  statement.setReadBigInts(true);
  const row = statement.get(actorId2, boardId);
  if (!row) {
    return void 0;
  }
  return {
    board: readSummary(row),
    trashedAtMillis: row.trashed_at_millis === null ? void 0 : readUnsigned(row.trashed_at_millis, "trashed_at_millis")
  };
}
function changeBoard(connection, change) {
  const { board, trashedAtMillis } = change;
  const { boardId, title, updatedAtMillis, entryVersion, pinned } = board;
  if (updatedAtMillis === void 0) {
    throw new Error("Catalog changes require an update timestamp.");
  }
  connection.prepare("UPDATE boards SET title = ? WHERE board_id = ?").run(title, boardId);
  connection.prepare(`
      INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (board_id) DO UPDATE SET
        updated_at_millis = excluded.updated_at_millis,
        pinned = excluded.pinned,
        entry_version = excluded.entry_version
    `).run(boardId, updatedAtMillis, Number(pinned), entryVersion);
  connection.prepare("UPDATE board_lifecycle SET trashed_at_millis = ? WHERE board_id = ?").run(trashedAtMillis ?? null, boardId);
}
function deleteBoard(connection, boardId) {
  connection.prepare("DELETE FROM boards WHERE board_id = ?").run(boardId);
}
function saveBoard(connection, actorId2, receipt) {
  const { commandId, board } = receipt;
  const { boardId, title, updatedAtMillis, pinned, entryVersion } = board;
  if (updatedAtMillis === void 0) {
    throw new Error("New catalog entries require an update timestamp.");
  }
  const pinValue = Number(pinned);
  connection.prepare("INSERT INTO boards (board_id, title, revision) VALUES (?, ?, 0)").run(boardId, title);
  connection.prepare("INSERT INTO board_members (board_id, actor_id, can_edit) VALUES (?, ?, 1)").run(boardId, actorId2);
  connection.prepare(`
    INSERT INTO catalog_entries (board_id, updated_at_millis, pinned, entry_version)
    VALUES (?, ?, ?, ?)
  `).run(boardId, updatedAtMillis, pinValue, entryVersion);
  connection.prepare(`
    INSERT INTO catalog_create_receipts (
      actor_id, command_id, board_id, title, updated_at_millis, pinned, entry_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actorId2, commandId, boardId, title, updatedAtMillis, pinValue, entryVersion);
}
function saveDuplicatedBoard(connection, actorId2, sourceBoardId, receipt) {
  const rejected5 = duplicateBoard2(
    connection,
    sourceBoardId,
    receipt.board.boardId,
    () => saveBoard(connection, actorId2, receipt)
  );
  if (rejected5) {
    return rejected5;
  }
  connection.prepare(
    "INSERT INTO catalog_duplicate_sources (actor_id, command_id, source_board_id) VALUES (?, ?, ?)"
  ).run(actorId2, receipt.commandId, sourceBoardId);
  return void 0;
}
function createCatalogRepository(database) {
  database.write((connection) => connection.exec(catalogSchema));
  return {
    listBoards: (lookup) => database.read((connection) => listBoards2(connection, lookup)),
    listTrashedBoards: (lookup) => database.read((connection) => listTrashedBoards2(connection, lookup)),
    getReceipt: (actorId2, commandId) => database.read((connection) => getReceipt(connection, actorId2, commandId)?.receipt),
    write: (work) => database.write(
      (connection) => work({
        getReceipt: (actorId2, commandId) => getReceipt(connection, actorId2, commandId),
        saveBoard: (actorId2, receipt) => saveBoard(connection, actorId2, receipt),
        duplicateBoard: (actorId2, sourceBoardId, receipt) => saveDuplicatedBoard(connection, actorId2, sourceBoardId, receipt),
        getManagedBoard: (actorId2, boardId) => getManagedBoard(connection, actorId2, boardId),
        changeBoard: (board) => changeBoard(connection, board),
        deleteBoard: (boardId) => deleteBoard(connection, boardId),
        saveManagementReceipt: (actorId2, signature, receipt) => saveManagementReceipt(connection, actorId2, signature, receipt)
      })
    )
  };
}

// src/infrastructure/adapters/feedback/stored-values.ts
function readText(value, field) {
  if (typeof value !== "string") {
    throw new Error(`Invalid stored feedback text for ${field}.`);
  }
  return value;
}
function readFinite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid stored feedback number for ${field}.`);
  }
  return value;
}
function readUnsigned2(value, field) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`Invalid stored feedback integer for ${field}.`);
  }
  return value;
}
function readOptionalUnsigned(value, field) {
  return value === null ? void 0 : readUnsigned2(value, field);
}
function readBool(value, field) {
  if (value !== 0n && value !== 1n) {
    throw new Error(`Invalid stored feedback boolean for ${field}.`);
  }
  return value === 1n;
}

// src/infrastructure/adapters/feedback/messages.ts
var messageColumns = `
  m.message_id,
  m.author_actor_id,
  m.text,
  m.created_at_millis,
  m.updated_at_millis AS message_updated_at_millis,
  m.version AS message_version
`;
function readMessage2(row) {
  return {
    messageId: readText(row.message_id, "message_id"),
    authorActorId: readText(row.author_actor_id, "author_actor_id"),
    text: readText(row.text, "text"),
    createdAtMillis: readUnsigned2(row.created_at_millis, "created_at_millis"),
    updatedAtMillis: readUnsigned2(row.message_updated_at_millis, "message_updated_at_millis"),
    version: readUnsigned2(row.message_version, "message_version")
  };
}
function getMessage(connection, boardId, threadId, messageId) {
  const statement = connection.prepare(`
    SELECT ${messageColumns}
    FROM feedback_messages AS m
    WHERE m.board_id = ? AND m.thread_id = ? AND m.message_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, threadId, messageId);
  return row && readMessage2(row);
}
function listReplies(connection, boardId, threadId, afterPosition, limit) {
  const statement = connection.prepare(`
    SELECT ${messageColumns}
    FROM feedback_messages AS m
    WHERE m.board_id = ? AND m.thread_id = ? AND m.position > ?
    ORDER BY m.position ASC
    LIMIT ?
  `);
  statement.setReadBigInts(true);
  return statement.all(boardId, threadId, afterPosition, limit).map(readMessage2);
}
function insertMessage(connection, boardId, threadId, position, message) {
  const { messageId, authorActorId, text: text2, createdAtMillis, updatedAtMillis, version } = message;
  connection.prepare(`
      INSERT INTO feedback_messages (
        board_id, thread_id, message_id, author_actor_id, text,
        created_at_millis, updated_at_millis, version, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    boardId,
    threadId,
    messageId,
    authorActorId,
    text2,
    createdAtMillis,
    updatedAtMillis,
    version,
    position
  );
}
function updateMessage(connection, boardId, threadId, message) {
  const { messageId, text: text2, updatedAtMillis, version } = message;
  connection.prepare(`
      UPDATE feedback_messages
      SET text = ?, updated_at_millis = ?, version = ?
      WHERE board_id = ? AND thread_id = ? AND message_id = ?
    `).run(text2, updatedAtMillis, version, boardId, threadId, messageId);
}

// src/infrastructure/adapters/feedback/receipts.ts
function readRejection(value) {
  switch (value) {
    case "invalidText":
    case "invalidAnchor":
    case "targetChanged":
    case "notFound":
    case "forbidden":
    case "versionChanged":
    case "commandIdReuse":
      return value;
    default:
      throw new Error("Invalid stored feedback rejection.");
  }
}
function readOutcome(row) {
  if (row.result_kind === "applied") {
    return {
      kind: "applied",
      threadId: readText(row.thread_id, "thread_id"),
      threadVersion: readUnsigned2(row.thread_version, "thread_version"),
      messageId: row.message_id === null ? void 0 : readText(row.message_id, "message_id"),
      messageVersion: readOptionalUnsigned(row.message_version, "message_version"),
      deleted: readBool(row.deleted, "deleted")
    };
  }
  if (row.result_kind === "rejected") {
    return {
      kind: "rejected",
      reason: readRejection(row.reason),
      currentVersion: readOptionalUnsigned(row.current_version, "current_version")
    };
  }
  throw new Error("Invalid stored feedback receipt.");
}
function getReceipt2(connection, boardId, actorId2, commandId) {
  const statement = connection.prepare(`
    SELECT signature, result_kind, thread_id, thread_version, message_id, message_version,
      deleted, reason, current_version
    FROM feedback_command_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, actorId2, commandId);
  if (!row) {
    return void 0;
  }
  return {
    signature: readText(row.signature, "signature"),
    receipt: { boardId, commandId, outcome: readOutcome(row) }
  };
}
function saveReceipt(connection, actorId2, stored) {
  const { signature, receipt } = stored;
  const { boardId, commandId, outcome } = receipt;
  const fields = outcome.kind === "applied" ? [
    outcome.threadId,
    outcome.threadVersion,
    outcome.messageId ?? null,
    outcome.messageVersion ?? null,
    Number(outcome.deleted),
    null,
    null
  ] : [null, null, null, null, null, outcome.reason, outcome.currentVersion ?? null];
  connection.prepare(`
      INSERT INTO feedback_command_receipts (
        board_id, actor_id, command_id, signature, result_kind, thread_id, thread_version,
        message_id, message_version, deleted, reason, current_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(boardId, actorId2, commandId, signature, outcome.kind, ...fields);
}

// src/infrastructure/adapters/feedback/schema.ts
var feedbackSchema = `
  CREATE TABLE IF NOT EXISTS feedback_threads (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    source_board_revision INTEGER NOT NULL CHECK (source_board_revision >= 0),
    frozen_x REAL NOT NULL,
    frozen_y REAL NOT NULL,
    object_id TEXT,
    object_u REAL,
    object_v REAL,
    object_geometry_version INTEGER,
    object_kind TEXT,
    object_label TEXT,
    object_x REAL,
    object_y REAL,
    object_width REAL,
    object_height REAL,
    object_rotation REAL,
    version INTEGER NOT NULL CHECK (version >= 1),
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= 0),
    reply_count INTEGER NOT NULL CHECK (reply_count BETWEEN 0 AND 4294967295),
    PRIMARY KEY (board_id, thread_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS feedback_threads_recent
    ON feedback_threads (board_id, updated_at_millis DESC, thread_id DESC);

  CREATE INDEX IF NOT EXISTS feedback_threads_by_status
    ON feedback_threads (board_id, status, updated_at_millis DESC, thread_id DESC);

  CREATE TABLE IF NOT EXISTS feedback_messages (
    board_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    author_actor_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at_millis INTEGER NOT NULL CHECK (created_at_millis >= 0),
    updated_at_millis INTEGER NOT NULL CHECK (updated_at_millis >= created_at_millis),
    version INTEGER NOT NULL CHECK (version >= 1),
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4294967295),
    CHECK ((position = 0) = (message_id = thread_id)),
    PRIMARY KEY (board_id, thread_id, message_id),
    UNIQUE (board_id, thread_id, position),
    FOREIGN KEY (board_id, thread_id) REFERENCES feedback_threads (board_id, thread_id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS feedback_command_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    result_kind TEXT NOT NULL CHECK (result_kind IN ('applied', 'rejected')),
    thread_id TEXT,
    thread_version INTEGER,
    message_id TEXT,
    message_version INTEGER,
    deleted INTEGER CHECK (deleted IN (0, 1)),
    reason TEXT,
    current_version INTEGER,
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

// src/infrastructure/adapters/feedback/threads.ts
var selectThreads = `
  SELECT t.*, ${messageColumns}, live.object_id AS live_object_id
  FROM feedback_threads AS t
  JOIN feedback_messages AS m
    ON m.board_id = t.board_id AND m.thread_id = t.thread_id AND m.position = 0
  LEFT JOIN board_objects AS live ON live.board_id = t.board_id AND live.object_id = t.object_id
`;
function readStatus2(value) {
  if (value === "open" || value === "resolved") {
    return value;
  }
  throw new Error("Invalid stored feedback status.");
}
function readFrozenObject(row) {
  return {
    kind: readText(row.object_kind, "object_kind"),
    label: readText(row.object_label, "object_label"),
    x: readFinite(row.object_x, "object_x"),
    y: readFinite(row.object_y, "object_y"),
    width: readFinite(row.object_width, "object_width"),
    height: readFinite(row.object_height, "object_height"),
    rotation: readFinite(row.object_rotation, "object_rotation")
  };
}
function readAnchor(row) {
  const sourceBoardRevision = readUnsigned2(row.source_board_revision, "source_board_revision");
  const frozenPoint = {
    x: readFinite(row.frozen_x, "frozen_x"),
    y: readFinite(row.frozen_y, "frozen_y")
  };
  if (row.object_id === null) {
    return {
      target: { kind: "board", point: frozenPoint },
      sourceBoardRevision,
      frozenPoint,
      targetMissing: false
    };
  }
  return {
    target: {
      kind: "object",
      objectId: readText(row.object_id, "object_id"),
      u: readFinite(row.object_u, "object_u"),
      v: readFinite(row.object_v, "object_v"),
      geometryVersion: readUnsigned2(row.object_geometry_version, "object_geometry_version")
    },
    sourceBoardRevision,
    frozenPoint,
    frozenObject: readFrozenObject(row),
    targetMissing: row.live_object_id === null
  };
}
function readThread(row) {
  return {
    threadId: readText(row.thread_id, "thread_id"),
    status: readStatus2(row.status),
    anchor: readAnchor(row),
    first: readMessage2(row),
    version: readUnsigned2(row.version, "version"),
    updatedAtMillis: readUnsigned2(row.updated_at_millis, "updated_at_millis"),
    replyCount: Number(readUnsigned2(row.reply_count, "reply_count"))
  };
}
function getThread(connection, boardId, threadId) {
  const statement = connection.prepare(`
    ${selectThreads}
    WHERE t.board_id = ? AND t.thread_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, threadId);
  return row && readThread(row);
}
function listThreads(connection, lookup) {
  const { boardId, limit, position, status, authorActorId } = lookup;
  const conditions = ["t.board_id = ?"];
  const args = [boardId];
  if (status) {
    conditions.push("t.status = ?");
    args.push(status);
  }
  if (authorActorId) {
    conditions.push("m.author_actor_id = ?");
    args.push(authorActorId);
  }
  if (position) {
    conditions.push("(t.updated_at_millis, t.thread_id) < (?, ?)");
    args.push(position.updatedAtMillis, position.threadId);
  }
  const statement = connection.prepare(`
    ${selectThreads}
    WHERE ${conditions.join(" AND ")}
    ORDER BY t.updated_at_millis DESC, t.thread_id DESC
    LIMIT ?
  `);
  statement.setReadBigInts(true);
  return statement.all(...args, limit).map(readThread);
}
function objectFields(anchor) {
  const { target: target2, frozenObject } = anchor;
  if (target2.kind === "board") {
    return [null, null, null, null, null, null, null, null, null, null, null];
  }
  if (!frozenObject) {
    throw new Error("Object feedback requires frozen source geometry.");
  }
  const { kind, label, x, y, width, height, rotation } = frozenObject;
  return [
    target2.objectId,
    target2.u,
    target2.v,
    target2.geometryVersion,
    kind,
    label,
    x,
    y,
    width,
    height,
    rotation
  ];
}
function insertThread(connection, boardId, thread) {
  const { threadId, status, anchor, updatedAtMillis, version, replyCount } = thread;
  const { frozenPoint, sourceBoardRevision } = anchor;
  connection.prepare(`
      INSERT INTO feedback_threads (
        board_id, thread_id, status, source_board_revision, frozen_x, frozen_y,
        object_id, object_u, object_v, object_geometry_version,
        object_kind, object_label, object_x, object_y, object_width, object_height, object_rotation,
        version, updated_at_millis, reply_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    boardId,
    threadId,
    status,
    sourceBoardRevision,
    frozenPoint.x,
    frozenPoint.y,
    ...objectFields(anchor),
    version,
    updatedAtMillis,
    replyCount
  );
  insertMessage(connection, boardId, threadId, 0, thread.first);
}
function updateThread(connection, boardId, thread) {
  const { threadId, status, updatedAtMillis, version, replyCount } = thread;
  connection.prepare(`
      UPDATE feedback_threads
      SET status = ?, version = ?, updated_at_millis = ?, reply_count = ?
      WHERE board_id = ? AND thread_id = ?
    `).run(status, version, updatedAtMillis, replyCount, boardId, threadId);
}
function deleteThread(connection, boardId, threadId) {
  connection.prepare("DELETE FROM feedback_threads WHERE board_id = ? AND thread_id = ?").run(boardId, threadId);
}

// src/infrastructure/adapters/feedback/index.ts
function getBoardRevision(connection, boardId) {
  const statement = connection.prepare("SELECT revision FROM boards WHERE board_id = ?");
  statement.setReadBigInts(true);
  return readUnsigned2(statement.get(boardId)?.revision, "revision");
}
function getObject(connection, boardId, objectId) {
  const statement = connection.prepare(`
    SELECT kind, label, x, y, width, height, rotation, geometry_version
    FROM board_objects
    WHERE board_id = ? AND object_id = ?
  `);
  statement.setReadBigInts(true);
  const row = statement.get(boardId, objectId);
  if (!row) {
    return void 0;
  }
  return {
    objectId,
    kind: readText(row.kind, "kind"),
    label: readText(row.label, "label"),
    x: readFinite(row.x, "x"),
    y: readFinite(row.y, "y"),
    width: readFinite(row.width, "width"),
    height: readFinite(row.height, "height"),
    rotation: readFinite(row.rotation, "rotation"),
    geometryVersion: readUnsigned2(row.geometry_version, "geometry_version")
  };
}
function allocateId(connection) {
  const row = connection.prepare("SELECT lower(hex(randomblob(16))) AS id").get();
  return readText(row?.id, "id");
}
function createReader(connection) {
  return {
    getAccess: (boardId, actorId2) => readBoardAccess(connection, boardId, actorId2),
    getBoardRevision: (boardId) => getBoardRevision(connection, boardId),
    getObject: (boardId, objectId) => getObject(connection, boardId, objectId),
    listThreads: (lookup) => listThreads(connection, lookup),
    getThread: (boardId, threadId) => getThread(connection, boardId, threadId),
    listReplies: (boardId, threadId, afterPosition, limit) => listReplies(connection, boardId, threadId, afterPosition, limit),
    getMessage: (boardId, threadId, messageId) => getMessage(connection, boardId, threadId, messageId),
    getReceipt: (boardId, actorId2, commandId) => getReceipt2(connection, boardId, actorId2, commandId)
  };
}
function createFeedbackRepository(database) {
  database.write((connection) => connection.exec(feedbackSchema));
  return {
    read: (work) => database.read((connection) => work(createReader(connection))),
    write: (work) => database.write(
      (connection) => work({
        ...createReader(connection),
        allocateId: () => allocateId(connection),
        insertThread: (boardId, thread) => insertThread(connection, boardId, thread),
        updateThread: (boardId, thread) => updateThread(connection, boardId, thread),
        insertReply: (boardId, threadId, position, message) => insertMessage(connection, boardId, threadId, position, message),
        updateMessage: (boardId, threadId, message) => updateMessage(connection, boardId, threadId, message),
        deleteThread: (boardId, threadId) => deleteThread(connection, boardId, threadId),
        saveReceipt: (actorId2, stored) => saveReceipt(connection, actorId2, stored)
      })
    )
  };
}

// src/infrastructure/adapters/stored-values.ts
var maxSqliteInteger = 9223372036854775807n;
var versionPattern = /^(?:0|[1-9][0-9]{0,18})$/u;
function storedText(value, field) {
  if (typeof value !== "string") {
    throw new Error(`Invalid stored text for ${field}.`);
  }
  return value;
}
function storedNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid stored number for ${field}.`);
  }
  return value;
}
function storedBool(value, field) {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid stored boolean for ${field}.`);
  }
  return value;
}
function storedSqliteBool(value, field) {
  if (value !== 0n && value !== 1n) {
    throw new Error(`Invalid stored SQLite boolean for ${field}.`);
  }
  return value === 1n;
}
function storedVersion(value, field) {
  if (typeof value !== "bigint" || value < 0n || value > maxSqliteInteger) {
    throw new Error(`Invalid stored version for ${field}.`);
  }
  return value;
}
function storedDecimalVersion(value, field) {
  const text2 = storedText(value, field);
  if (!versionPattern.test(text2)) {
    throw new Error(`Invalid stored decimal version for ${field}.`);
  }
  return storedVersion(BigInt(text2), field);
}
function storedRecord(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid stored object for ${field}.`);
  }
  return value;
}
function storedArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid stored array for ${field}.`);
  }
  return value;
}
function decodeJson(text2, field) {
  return JSON.parse(
    storedText(text2, field),
    (_key, value) => typeof value === "number" ? storedNumber(value, field) : value
  );
}
function decodePayload(text2) {
  return storedRecord(decodeJson(text2, "body_json"), "body_json");
}

// src/infrastructure/adapters/board-object-storage.ts
function decodePoint(value) {
  const { x, y } = storedRecord(value, "point");
  return { x: storedNumber(x, "x"), y: storedNumber(y, "y") };
}
function decodeAppearance(value) {
  const { fill, stroke, strokeWidth, dashed, hollow } = storedRecord(value, "appearance");
  return {
    fill: fill === void 0 ? void 0 : storedText(fill, "fill"),
    stroke: stroke === void 0 ? void 0 : storedText(stroke, "stroke"),
    strokeWidth: strokeWidth === void 0 ? void 0 : storedNumber(strokeWidth, "strokeWidth"),
    dashed: dashed === void 0 ? void 0 : storedBool(dashed, "dashed"),
    hollow: hollow === void 0 ? void 0 : storedBool(hollow, "hollow")
  };
}
function decodePort(value) {
  switch (value) {
    case void 0:
    case "top":
    case "bottom":
    case "left":
    case "right":
      return value;
    default:
      throw new Error("Invalid stored connector port.");
  }
}
function decodeHead(value) {
  switch (value) {
    case "none":
    case "circle":
    case "arrow":
      return value;
    default:
      throw new Error("Invalid stored connector head.");
  }
}
function decodeEndpoint(value) {
  const { point, attachment } = storedRecord(value, "endpoint");
  const position = decodePoint(point);
  if (attachment === void 0) {
    return { point: position };
  }
  const { objectId, port } = storedRecord(attachment, "attachment");
  return {
    point: position,
    attachment: { objectId: storedText(objectId, "objectId"), port: decodePort(port) }
  };
}
function decodeRelativeBends(value) {
  const { firstAxis, offsets } = storedRecord(value, "relativeBends");
  if (firstAxis !== "horizontal" && firstAxis !== "vertical") {
    throw new Error("Invalid stored connector bend axis.");
  }
  return {
    firstAxis,
    offsets: storedArray(offsets, "offsets").map((offset) => storedNumber(offset, "offset"))
  };
}
function decodeConnector(value) {
  const { start, end, bends, relativeBends, labelOffset, startHead, endHead } = value;
  return {
    kind: "connector",
    start: decodeEndpoint(start),
    end: decodeEndpoint(end),
    bends: storedArray(bends, "bends").map(decodePoint),
    relativeBends: relativeBends === void 0 ? void 0 : decodeRelativeBends(relativeBends),
    labelOffset: labelOffset === void 0 ? void 0 : decodePoint(labelOffset),
    startHead: startHead === void 0 ? void 0 : decodeHead(startHead),
    endHead: endHead === void 0 ? void 0 : decodeHead(endHead)
  };
}
function decodeDetail(value) {
  const detail = storedRecord(value, "detail");
  switch (detail.kind) {
    case "shape":
      return { kind: "shape", outline: storedText(detail.outline, "outline") };
    case "section":
      return { kind: "section", transparent: storedBool(detail.transparent, "transparent") };
    case "ink":
      return { kind: "ink", width: storedNumber(detail.width, "ink width") };
    case "connector":
      return decodeConnector(detail);
    default:
      throw new Error("Invalid stored geometry detail.");
  }
}
function decodeGeometry(value) {
  const { x, y, width, height, rotation } = value;
  return {
    x: storedNumber(x, "x"),
    y: storedNumber(y, "y"),
    width: storedNumber(width, "width"),
    height: storedNumber(height, "height"),
    rotation: storedNumber(rotation, "rotation")
  };
}
function decodeSceneObject(row) {
  return {
    objectId: storedText(row.object_id, "object_id"),
    kind: storedText(row.kind, "kind"),
    label: storedText(row.label, "label"),
    geometry: decodeGeometry(row),
    geometryVersion: storedVersion(row.geometry_version, "geometry_version"),
    payloadVersion: row.payload_version === null ? void 0 : storedVersion(row.payload_version, "payload_version"),
    locked: storedSqliteBool(row.locked, "locked"),
    parentId: row.parent_id === null ? void 0 : storedText(row.parent_id, "parent_id"),
    groupId: row.group_id === null ? void 0 : storedText(row.group_id, "group_id"),
    appearance: row.appearance_json === null ? void 0 : decodeAppearance(decodeJson(row.appearance_json, "appearance_json")),
    detail: row.detail_json === null ? void 0 : decodeDetail(decodeJson(row.detail_json, "detail_json"))
  };
}
function decodeReceiptObject(value) {
  const object = storedRecord(value, "receipt object");
  const { parentId, groupId, appearance: appearance2, detail, payloadVersion } = object;
  return {
    objectId: storedText(object.objectId, "objectId"),
    kind: storedText(object.kind, "kind"),
    label: storedText(object.label, "label"),
    geometry: decodeGeometry(storedRecord(object.geometry, "geometry")),
    geometryVersion: storedDecimalVersion(object.geometryVersion, "geometryVersion"),
    payloadVersion: payloadVersion === void 0 ? void 0 : storedDecimalVersion(payloadVersion, "payloadVersion"),
    locked: storedBool(object.locked, "locked"),
    parentId: parentId === void 0 ? void 0 : storedText(parentId, "parentId"),
    groupId: groupId === void 0 ? void 0 : storedText(groupId, "groupId"),
    appearance: appearance2 === void 0 ? void 0 : decodeAppearance(appearance2),
    detail: detail === void 0 ? void 0 : decodeDetail(detail)
  };
}

// src/infrastructure/adapters/board-history-storage.ts
var retainedVersions = 200;
var defaultPageSize3 = 50;
var boardHistorySchema = `
  CREATE TABLE IF NOT EXISTS board_versions (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    title TEXT NOT NULL,
    actor_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('baseline', 'geometry', 'content', 'image', 'restore')),
    saved_at_millis INTEGER CHECK (saved_at_millis >= 0),
    source_revision INTEGER CHECK (source_revision >= 0),
    changed_object_count INTEGER NOT NULL CHECK (changed_object_count >= 0),
    CHECK (kind = 'baseline' OR (actor_id IS NOT NULL AND saved_at_millis IS NOT NULL)),
    PRIMARY KEY (board_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_history_objects (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    change_revision INTEGER NOT NULL CHECK (change_revision > 0),
    object_id TEXT NOT NULL,
    kind TEXT,
    label TEXT,
    layer_index INTEGER,
    x REAL,
    y REAL,
    width REAL,
    height REAL,
    rotation REAL,
    geometry_version INTEGER,
    locked INTEGER,
    parent_id TEXT,
    group_id TEXT,
    appearance_json TEXT CHECK (appearance_json IS NULL OR json_valid(appearance_json)),
    detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
    PRIMARY KEY (board_id, object_id, change_revision)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_history_objects_by_revision
    ON board_history_objects (board_id, change_revision, object_id);

  CREATE TABLE IF NOT EXISTS board_history_payloads (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    change_revision INTEGER NOT NULL CHECK (change_revision > 0),
    object_id TEXT NOT NULL,
    payload_version INTEGER CHECK (payload_version >= 0),
    body_kind TEXT,
    body_json TEXT CHECK (body_json IS NULL OR json_valid(body_json)),
    PRIMARY KEY (board_id, object_id, change_revision),
    CHECK ((payload_version IS NULL AND body_kind IS NULL AND body_json IS NULL)
      OR (payload_version IS NOT NULL AND body_kind IS NOT NULL AND body_json IS NOT NULL))
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_history_payloads_by_revision
    ON board_history_payloads (board_id, change_revision, object_id);
`;
var objectColumns = [
  "kind",
  "label",
  "layer_index",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "geometry_version",
  "locked",
  "parent_id",
  "group_id",
  "appearance_json",
  "detail_json"
];
var versionColumns = "revision, title, actor_id, kind, saved_at_millis, source_revision, changed_object_count";
var requestedObjects = "requested AS (SELECT DISTINCT value AS object_id FROM json_each(?3))";
var requestedOnly = "AND object_id IN (SELECT object_id FROM requested)";
function objectProjection(alias) {
  return objectColumns.map((column) => `${alias}.${column}`).join(", ");
}
var captureObjects = `
  INSERT OR IGNORE INTO board_history_objects
    (board_id, change_revision, object_id, ${objectColumns.join(", ")})
  SELECT b.board_id, b.revision + 1, target.value, ${objectProjection("o")}
  FROM boards AS b
  CROSS JOIN json_each(?2) AS target
  LEFT JOIN board_objects AS o ON o.board_id = b.board_id AND o.object_id = target.value
  WHERE b.board_id = ?1
`;
var capturePayloads = `
  INSERT OR IGNORE INTO board_history_payloads
    (board_id, change_revision, object_id, payload_version, body_kind, body_json)
  SELECT b.board_id, b.revision + 1, target.value, p.payload_version, p.body_kind, p.body_json
  FROM boards AS b
  CROSS JOIN json_each(?2) AS target
  LEFT JOIN object_payloads AS p ON p.board_id = b.board_id AND p.object_id = target.value
  WHERE b.board_id = ?1
`;
function recordObjectHistory(connection, boardId, objectIds) {
  if (objectIds.length > 0) {
    connection.prepare(captureObjects).run(boardId, JSON.stringify(objectIds));
  }
}
function recordPayloadHistory(connection, boardId, objectIds) {
  if (objectIds.length > 0) {
    connection.prepare(capturePayloads).run(boardId, JSON.stringify(objectIds));
  }
}
function pruneBoardVersions(connection, boardId) {
  const query = connection.prepare(`
    SELECT revision FROM board_versions
    WHERE board_id = ? ORDER BY revision DESC LIMIT 1 OFFSET ?
  `);
  query.setReadBigInts(true);
  const floor = query.get(boardId, retainedVersions - 1)?.revision;
  if (floor === void 0) {
    return;
  }
  const revision = storedVersion(floor, "revision");
  connection.prepare("DELETE FROM board_versions WHERE board_id = ? AND revision < ?").run(boardId, revision);
  connection.prepare("DELETE FROM board_history_objects WHERE board_id = ? AND change_revision <= ?").run(boardId, revision);
  connection.prepare("DELETE FROM board_history_payloads WHERE board_id = ? AND change_revision <= ?").run(boardId, revision);
}
function publishBoardVersion(connection, before, after, commit) {
  if (after !== before.revision + 1n) {
    throw new Error("A board version must advance by one.");
  }
  const { boardId, title } = before;
  const { actorId: actorId2, kind, savedAtMillis, sourceRevision, changedObjectCount } = commit;
  connection.prepare(`
    INSERT INTO board_versions (board_id, ${versionColumns})
      SELECT ?1, ?2, ?3, NULL, 'baseline', NULL, NULL, 0
    WHERE NOT EXISTS (SELECT 1 FROM board_versions WHERE board_id = ?1)
  `).run(boardId, before.revision, title);
  connection.prepare(`
    INSERT INTO board_versions (board_id, ${versionColumns})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    boardId,
    after,
    title,
    actorId2,
    kind,
    savedAtMillis,
    sourceRevision ?? null,
    changedObjectCount
  );
  pruneBoardVersions(connection, boardId);
}
function versionKind2(value) {
  switch (value) {
    case "baseline":
    case "geometry":
    case "content":
    case "image":
    case "restore":
      return value;
    default:
      throw new Error("Invalid stored board version kind.");
  }
}
function safeVersionNumber(value, field) {
  const number = Number(storedVersion(value, field));
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Invalid stored number for ${field}.`);
  }
  return number;
}
function decodeVersion(row) {
  return {
    revision: storedVersion(row.revision, "revision"),
    title: storedText(row.title, "title"),
    actorId: row.actor_id === null ? void 0 : storedText(row.actor_id, "actor_id"),
    kind: versionKind2(row.kind),
    savedAtMillis: row.saved_at_millis === null ? void 0 : safeVersionNumber(row.saved_at_millis, "saved_at_millis"),
    sourceRevision: row.source_revision === null ? void 0 : storedVersion(row.source_revision, "source_revision"),
    changedObjectCount: safeVersionNumber(row.changed_object_count, "changed_object_count")
  };
}
function readBoardVersions(connection, boardId, before, limit = defaultPageSize3) {
  const cutoff = before === void 0 ? "" : "AND revision < ?3";
  const query = connection.prepare(`
    SELECT ${versionColumns} FROM board_versions
    WHERE board_id = ?1 ${cutoff} ORDER BY revision DESC LIMIT ?2
  `);
  query.setReadBigInts(true);
  const rows = before === void 0 ? query.all(boardId, limit) : query.all(boardId, limit, before);
  return rows.map(decodeVersion);
}
function readBoardVersion(connection, boardId, revision) {
  const query = connection.prepare(`
    SELECT ${versionColumns} FROM board_versions WHERE board_id = ? AND revision = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, revision);
  return row && decodeVersion(row);
}
function payloadHistoryJoin(source) {
  return `
    LEFT JOIN board_history_payloads AS prior
      ON prior.board_id = ?1 AND prior.object_id = ${source}.object_id
      AND prior.change_revision = (
        SELECT MIN(change_revision) FROM board_history_payloads
        WHERE board_id = ?1 AND object_id = ${source}.object_id AND change_revision > ?2
      )
  `;
}
function payloadValue(column) {
  return `CASE WHEN prior.change_revision IS NULL THEN p.${column} ELSE prior.${column} END`;
}
var historyPayloadSelection = `
  WITH ${requestedObjects}, history_payloads AS (
    SELECT target.object_id, ${payloadValue("payload_version")} AS payload_version,
      ${payloadValue("body_kind")} AS body_kind, ${payloadValue("body_json")} AS body_json
    FROM requested AS target
    LEFT JOIN object_payloads AS p ON p.board_id = ?1 AND p.object_id = target.object_id
    ${payloadHistoryJoin("target")}
  )
`;
function readVersionObjects(connection, boardId, revision, objectIds) {
  const request = objectIds === void 0 ? "" : `${requestedObjects},`;
  const scope2 = objectIds === void 0 ? "" : requestedOnly;
  const query = connection.prepare(`
    WITH ${request} first_change AS (
      SELECT object_id, MIN(change_revision) AS change_revision
      FROM board_history_objects WHERE board_id = ?1 AND change_revision > ?2 ${scope2}
      GROUP BY object_id
    ), history_scene AS (
      SELECT o.object_id, ${objectProjection("o")}
      FROM board_objects AS o
      WHERE board_id = ?1 ${scope2} AND o.object_id NOT IN (SELECT object_id FROM first_change)
      UNION ALL
      SELECT h.object_id, ${objectProjection("h")}
      FROM first_change AS change
      JOIN board_history_objects AS h ON h.board_id = ?1 AND h.object_id = change.object_id
        AND h.change_revision = change.change_revision
      WHERE h.kind IS NOT NULL
    )
    SELECT geometry.*, ${payloadValue("payload_version")} AS payload_version
    FROM history_scene AS geometry
    LEFT JOIN object_payloads AS p INDEXED BY object_payloads_versions
      ON p.board_id = ?1 AND p.object_id = geometry.object_id
    ${payloadHistoryJoin("geometry")}
    ORDER BY geometry.layer_index, geometry.object_id
  `);
  query.setReadBigInts(true);
  const rows = objectIds === void 0 ? query.all(boardId, revision) : query.all(boardId, revision, JSON.stringify(objectIds));
  return rows.map(decodeSceneObject);
}
function readVersionPayloads(connection, boardId, revision, objectIds) {
  if (objectIds.length === 0) {
    return [];
  }
  const query = connection.prepare(`
    ${historyPayloadSelection}
    SELECT * FROM history_payloads WHERE payload_version IS NOT NULL
  `);
  query.setReadBigInts(true);
  return query.all(boardId, revision, JSON.stringify(objectIds)).map((row) => ({
    objectId: storedText(row.object_id, "object_id"),
    payloadVersion: storedVersion(row.payload_version, "payload_version"),
    bodyKind: storedText(row.body_kind, "body_kind"),
    data: decodePayload(row.body_json)
  }));
}
function readVersionPayloadByteSize(connection, boardId, revision, objectIds) {
  if (objectIds.length === 0) {
    return 0n;
  }
  const query = connection.prepare(`
    ${historyPayloadSelection}
    SELECT COALESCE(SUM(length(CAST(body_json AS BLOB))), 0) AS byte_size
    FROM history_payloads WHERE payload_version IS NOT NULL
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, revision, JSON.stringify(objectIds));
  return storedVersion(row?.byte_size, "byte_size");
}

// src/infrastructure/adapters/board-edit-storage.ts
var minimumLayerRank = -(1n << 63n);
var maximumLayerRank = (1n << 63n) - 1n;
var layerSpacing = 1024n;
var boardEditSchema = `
  CREATE TABLE IF NOT EXISTS board_used_object_ids (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    PRIMARY KEY (board_id, object_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_edit_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
function hasUsedObjectId(connection, boardId, objectId) {
  const query = connection.prepare(`
    SELECT 1 FROM board_objects WHERE board_id = ? AND object_id = ?
    UNION ALL
    SELECT 1 FROM board_used_object_ids WHERE board_id = ? AND object_id = ?
    LIMIT 1
  `);
  return query.get(boardId, objectId, boardId, objectId) !== void 0;
}
function advanceBoardRevision(connection, boardId) {
  const update2 = connection.prepare(`
    UPDATE boards SET revision = revision + 1
    WHERE board_id = ?
    RETURNING revision
  `);
  update2.setReadBigInts(true);
  return storedVersion(update2.get(boardId)?.revision, "revision");
}
function recordUsedIds(connection, boardId, ids) {
  if (!ids.length) {
    return;
  }
  connection.prepare(`
      INSERT OR IGNORE INTO board_used_object_ids (board_id, object_id)
      SELECT ?, value FROM json_each(?)
    `).run(boardId, JSON.stringify(ids));
}
function removeObjects(connection, boardId, ids, table) {
  if (!ids.length) {
    return;
  }
  connection.prepare(
    `DELETE FROM ${table} WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))`
  ).run(boardId, JSON.stringify(ids));
}
function saveAssets(connection, boardId, assets) {
  if (!assets?.length) {
    return;
  }
  const insert = connection.prepare(`
    INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) VALUES (?, ?, ?, ?)
  `);
  for (const asset of assets) {
    insert.run(boardId, asset.assetId, asset.mimeType, asset.bytes);
  }
}
function storeObjects(connection, boardId, objects) {
  if (!objects.length) {
    return [];
  }
  const { firstRank, normalizedIds } = reserveLayerRanks(connection, boardId, objects.length);
  const upsert = connection.prepare(`
    INSERT INTO board_objects (
      board_id, object_id, kind, label, layer_index, x, y, width, height, rotation,
      geometry_version, locked, parent_id, group_id, appearance_json, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (board_id, object_id) DO UPDATE SET
      kind = excluded.kind, label = excluded.label, x = excluded.x, y = excluded.y,
      width = excluded.width, height = excluded.height, rotation = excluded.rotation,
      geometry_version = excluded.geometry_version, locked = excluded.locked,
      parent_id = excluded.parent_id, group_id = excluded.group_id,
      appearance_json = excluded.appearance_json, detail_json = excluded.detail_json
  `);
  let layer = firstRank;
  for (const object of objects) {
    const { geometry, objectId, kind, label, geometryVersion, locked } = object;
    upsert.run(
      boardId,
      objectId,
      kind,
      label,
      layer,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
      geometry.rotation,
      geometryVersion,
      Number(locked),
      object.parentId ?? null,
      object.groupId ?? null,
      object.appearance ? JSON.stringify(object.appearance) : null,
      object.detail ? JSON.stringify(object.detail) : null
    );
    layer += 1n;
  }
  return normalizedIds;
}
function savePayloads(connection, boardId, payloads) {
  if (!payloads.length) {
    return;
  }
  const upsert = connection.prepare(`
    INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (board_id, object_id) DO UPDATE SET
      payload_version = excluded.payload_version,
      body_kind = excluded.body_kind,
      body_json = excluded.body_json
  `);
  for (const payload of payloads) {
    upsert.run(
      boardId,
      payload.objectId,
      payload.payloadVersion,
      payload.bodyKind,
      JSON.stringify(payload.data)
    );
  }
}
function decodeLayerRank(value) {
  if (typeof value !== "bigint") {
    throw new Error("Invalid stored object layer rank.");
  }
  return value;
}
function readLayerRanks(connection, boardId) {
  const query = connection.prepare(`
    SELECT object_id, layer_index FROM board_objects WHERE board_id = ?
    ORDER BY layer_index, object_id
  `);
  query.setReadBigInts(true);
  return query.all(boardId).map((row) => ({
    objectId: storedText(row.object_id, "object_id"),
    rank: decodeLayerRank(row.layer_index)
  }));
}
function writeLayerRanks(connection, boardId, changes) {
  if (changes.length === 0) {
    return [];
  }
  const ids = changes.map(({ objectId }) => objectId);
  recordObjectHistory(connection, boardId, ids);
  const update2 = connection.prepare(`
    UPDATE board_objects SET layer_index = ? WHERE board_id = ? AND object_id = ?
  `);
  for (const { objectId, rank } of changes) {
    update2.run(rank, boardId, objectId);
  }
  return ids;
}
function layerChanges(order, positions, rankAt) {
  const changes = [];
  for (const [index, objectId] of order.entries()) {
    const rank = rankAt(index);
    if (rank === void 0) {
      throw new Error("Missing target layer rank.");
    }
    if (positions.get(objectId) !== rank) {
      changes.push({ objectId, rank });
    }
  }
  return changes;
}
function reserveLayerRanks(connection, boardId, count) {
  const query = connection.prepare(
    "SELECT MAX(layer_index) AS top_rank FROM board_objects WHERE board_id = ?"
  );
  query.setReadBigInts(true);
  const topRank = query.get(boardId)?.top_rank;
  const firstRank = topRank === null ? 0n : decodeLayerRank(topRank) + 1n;
  if (firstRank + BigInt(count - 1) <= maximumLayerRank) {
    return { firstRank, normalizedIds: [] };
  }
  const ranks = readLayerRanks(connection, boardId);
  const positions = new Map(ranks.map(({ objectId, rank }) => [objectId, rank]));
  const changes = layerChanges(
    ranks.map(({ objectId }) => objectId),
    positions,
    BigInt
  );
  return {
    firstRank: BigInt(ranks.length),
    normalizedIds: writeLayerRanks(connection, boardId, changes)
  };
}
function validLayerOrder(order, positions) {
  if (positions.size !== order.length || new Set(order).size !== positions.size || !order.every((id) => positions.has(id))) {
    return false;
  }
  return true;
}
function boundaryLayerChanges(current, order, positions, placement) {
  const selected = new Set(placement.objectIds);
  const rest = current.filter(({ objectId }) => !selected.has(objectId));
  const atFront = placement.position === "front";
  const firstSelected = atFront ? rest.length : 0;
  const restStart = atFront ? 0 : selected.size;
  const movedMatch = placement.objectIds.every((id, index) => id === order[firstSelected + index]);
  const restMatch = rest.every(({ objectId }, index) => objectId === order[restStart + index]);
  if (!movedMatch || !restMatch || rest.length + selected.size !== current.length) {
    throw new Error("Layer placement does not match the updated order.");
  }
  const edge = atFront ? rest.at(-1) : rest[0];
  if (!edge) {
    return void 0;
  }
  const count = BigInt(placement.objectIds.length);
  const start = atFront ? edge.rank + layerSpacing : edge.rank - count * layerSpacing;
  const end = start + (count - 1n) * layerSpacing;
  if (start < minimumLayerRank || end > maximumLayerRank) {
    return void 0;
  }
  return layerChanges(
    placement.objectIds,
    positions,
    (index) => start + BigInt(index) * layerSpacing
  );
}
function writeLayerOrder(connection, boardId, order, placement) {
  if (!order) {
    return [];
  }
  const current = readLayerRanks(connection, boardId);
  const positions = new Map(current.map(({ objectId, rank }) => [objectId, rank]));
  if (!validLayerOrder(order, positions)) {
    throw new Error("Updated layer order must describe exactly the objects in the board.");
  }
  if (order.every((id, index) => current[index]?.objectId === id)) {
    return [];
  }
  const hasUniqueRanks = new Set(positions.values()).size === positions.size;
  const sparse = placement && hasUniqueRanks ? boundaryLayerChanges(current, order, positions, placement) : void 0;
  const canReuseRanks = !placement && hasUniqueRanks;
  const rankAt = canReuseRanks ? (index) => current[index]?.rank : BigInt;
  const changes = sparse ?? layerChanges(order, positions, rankAt);
  return writeLayerRanks(connection, boardId, changes);
}
function persistChanges(connection, boardId, change) {
  const { objects, removedObjectIds, payloads, removedPayloadObjectIds } = change;
  const objectIds = [.../* @__PURE__ */ new Set([...objects.map(({ objectId }) => objectId), ...removedObjectIds])];
  const payloadIds = [
    .../* @__PURE__ */ new Set([
      ...payloads.map(({ objectId }) => objectId),
      ...removedPayloadObjectIds,
      ...removedObjectIds
    ])
  ];
  recordObjectHistory(connection, boardId, objectIds);
  recordPayloadHistory(connection, boardId, payloadIds);
  recordUsedIds(connection, boardId, objectIds);
  removeObjects(connection, boardId, removedObjectIds, "board_objects");
  removeObjects(connection, boardId, removedPayloadObjectIds, "object_payloads");
  const normalizedLayerIds = storeObjects(connection, boardId, objects);
  savePayloads(connection, boardId, payloads);
  return { metadataIds: [.../* @__PURE__ */ new Set([...objectIds, ...payloadIds])], normalizedLayerIds };
}
function applyBoardChanges(connection, board, changes, commit, getObjects) {
  const { boardId } = board;
  const {
    objects = [],
    removedObjectIds = [],
    payloads = [],
    removedPayloadObjectIds = [],
    order,
    layerPlacement,
    assets
  } = changes;
  saveAssets(connection, boardId, assets);
  const { metadataIds, normalizedLayerIds } = persistChanges(connection, boardId, {
    objects,
    removedObjectIds,
    payloads,
    removedPayloadObjectIds
  });
  const orderedIds = writeLayerOrder(connection, boardId, order, layerPlacement);
  const changed = /* @__PURE__ */ new Set([...metadataIds, ...normalizedLayerIds, ...orderedIds]);
  let boardRevision = board.revision;
  if (changed.size) {
    boardRevision = advanceBoardRevision(connection, boardId);
    publishBoardVersion(connection, board, boardRevision, {
      ...commit,
      changedObjectCount: changed.size
    });
  }
  return {
    kind: "applied",
    boardRevision,
    objects: metadataIds.length ? getObjects(metadataIds) : [],
    removedObjectIds,
    payloads,
    removedPayloadObjectIds,
    order
  };
}

// src/infrastructure/adapters/board-edit-receipts.ts
function payloadReference(raw) {
  const value = storedRecord(raw, "receipt payload reference");
  return {
    objectId: storedText(value.objectId, "objectId"),
    payloadVersion: storedDecimalVersion(value.payloadVersion, "payloadVersion")
  };
}
function serializedReference({ objectId, payloadVersion }) {
  return { objectId, payloadVersion: payloadVersion.toString() };
}
function hasVersion(connection, boardId, revision) {
  const available = connection.prepare(`
    SELECT 1 FROM board_versions WHERE board_id = ?1 AND revision = ?2
    UNION ALL
    SELECT 1 FROM boards WHERE board_id = ?1 AND revision = ?2
    LIMIT 1
  `).get(boardId, revision);
  return available !== void 0;
}
function readMatchingCurrentPayloads(connection, boardId, references) {
  if (!references.length) {
    return [];
  }
  const query = connection.prepare(`
    SELECT p.object_id, p.payload_version, p.body_kind, p.body_json
    FROM json_each(?) AS expected
    CROSS JOIN object_payloads AS p
      ON p.board_id = ? AND p.object_id = json_extract(expected.value, '$.objectId')
        AND p.payload_version = CAST(json_extract(expected.value, '$.payloadVersion') AS INTEGER)
  `);
  query.setReadBigInts(true);
  return query.all(JSON.stringify(references.map(serializedReference)), boardId).map((row) => ({
    objectId: storedText(row.object_id, "object_id"),
    payloadVersion: storedVersion(row.payload_version, "payload_version"),
    bodyKind: storedText(row.body_kind, "body_kind"),
    data: decodePayload(row.body_json)
  }));
}
function readReceiptDetails(connection, boardId, revision, snapshot) {
  const references = storedArray(snapshot.payloads, "payloads").map(payloadReference);
  const hasOrder = snapshot.hasOrder === void 0 ? snapshot.order !== void 0 : storedBool(snapshot.hasOrder, "hasOrder");
  if (!references.length && !hasOrder) {
    return { payloads: [] };
  }
  const available = hasVersion(connection, boardId, revision);
  const found = available ? readVersionPayloads(
    connection,
    boardId,
    revision,
    references.map(({ objectId }) => objectId)
  ) : readMatchingCurrentPayloads(connection, boardId, references);
  const byId = new Map(found.map((payload) => [payload.objectId, payload]));
  const payloads = references.flatMap(({ objectId, payloadVersion }) => {
    const payload = byId.get(objectId);
    return payload?.payloadVersion === payloadVersion ? [payload] : [];
  });
  const order = hasOrder && available ? readVersionObjects(connection, boardId, revision).map(({ objectId }) => objectId) : void 0;
  const missingDetails = payloads.length !== references.length || hasOrder && order === void 0;
  return { payloads, order, detailsExpired: missingDetails || void 0 };
}
function storedIds(raw, field) {
  return storedArray(raw, field).map((id) => storedText(id, field));
}
function readEditReceipt(connection, boardId, actorId2, commandId) {
  const row = connection.prepare(`
    SELECT signature, receipt_json FROM board_edit_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `).get(boardId, actorId2, commandId);
  if (!row) {
    return void 0;
  }
  const value = storedRecord(decodeJson(row.receipt_json, "receipt_json"), "receipt_json");
  const boardRevision = storedDecimalVersion(value.boardRevision, "boardRevision");
  return {
    signature: storedText(row.signature, "signature"),
    receipt: {
      boardId,
      commandId,
      outcome: {
        kind: "applied",
        boardRevision,
        objects: storedArray(value.objects, "objects").map(decodeReceiptObject),
        ...readReceiptDetails(connection, boardId, boardRevision, value),
        removedObjectIds: storedIds(value.removedObjectIds, "removedObjectIds"),
        removedPayloadObjectIds: storedIds(
          value.removedPayloadObjectIds,
          "removedPayloadObjectIds"
        )
      }
    }
  };
}
function saveEditReceipt(connection, actorId2, { signature, receipt }) {
  const { boardId, commandId, outcome } = receipt;
  if (outcome.kind !== "applied") {
    throw new Error("Only applied board changes have a durable receipt.");
  }
  const snapshot = JSON.stringify({
    boardRevision: outcome.boardRevision.toString(),
    objects: outcome.objects.map((object) => ({
      ...object,
      geometryVersion: object.geometryVersion.toString(),
      payloadVersion: object.payloadVersion?.toString()
    })),
    payloads: outcome.payloads.map(serializedReference),
    removedObjectIds: outcome.removedObjectIds,
    removedPayloadObjectIds: outcome.removedPayloadObjectIds ?? [],
    hasOrder: outcome.order !== void 0
  });
  connection.prepare(`
    INSERT INTO board_edit_receipts (board_id, actor_id, command_id, signature, receipt_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(boardId, actorId2, commandId, signature, snapshot);
}

// src/infrastructure/adapters/whiteboard-schema.ts
var whiteboardSchema = `
  CREATE TABLE IF NOT EXISTS boards (
    board_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_members (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    can_edit INTEGER NOT NULL CHECK (can_edit IN (0, 1)),
    PRIMARY KEY (board_id, actor_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_lifecycle (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    owner_actor_id TEXT NOT NULL,
    trashed_at_millis INTEGER CHECK (trashed_at_millis >= 0)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_lifecycle_trash_by_owner
    ON board_lifecycle (owner_actor_id, trashed_at_millis DESC, board_id)
    WHERE trashed_at_millis IS NOT NULL;

  CREATE TABLE IF NOT EXISTS board_objects (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    object_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    layer_index INTEGER NOT NULL DEFAULT 0,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL CHECK (width >= 0),
    height REAL NOT NULL CHECK (height >= 0),
    rotation REAL NOT NULL DEFAULT 0,
    geometry_version INTEGER NOT NULL DEFAULT 0 CHECK (geometry_version >= 0),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    parent_id TEXT,
    group_id TEXT,
    appearance_json TEXT CHECK (json_valid(appearance_json)),
    detail_json TEXT CHECK (json_valid(detail_json)),
    PRIMARY KEY (board_id, object_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS board_objects_layer
    ON board_objects (board_id, layer_index, object_id);
  CREATE INDEX IF NOT EXISTS board_objects_group
    ON board_objects (board_id, group_id, layer_index, object_id);
  CREATE INDEX IF NOT EXISTS board_objects_parent
    ON board_objects (board_id, parent_id, layer_index, object_id);

  CREATE INDEX IF NOT EXISTS board_connector_start
    ON board_objects (board_id, json_extract(detail_json, '$.start.attachment.objectId'), object_id)
    WHERE kind = 'connector';
  CREATE INDEX IF NOT EXISTS board_connector_end
    ON board_objects (board_id, json_extract(detail_json, '$.end.attachment.objectId'), object_id)
    WHERE kind = 'connector';

  CREATE TABLE IF NOT EXISTS object_payloads (
    board_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    payload_version INTEGER NOT NULL CHECK (payload_version >= 0),
    body_kind TEXT NOT NULL,
    body_json TEXT NOT NULL CHECK (json_valid(body_json)),
    PRIMARY KEY (board_id, object_id),
    FOREIGN KEY (board_id, object_id) REFERENCES board_objects (board_id, object_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS object_payloads_versions
    ON object_payloads (board_id, object_id, payload_version);

  CREATE TABLE IF NOT EXISTS command_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

// src/infrastructure/adapters/board-suggestions.ts
var boardSuggestionsSchema = `
  CREATE TABLE IF NOT EXISTS board_review_sources (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    owner_actor_id TEXT NOT NULL,
    board_revision INTEGER NOT NULL CHECK (board_revision >= 0),
    object_ids_json TEXT NOT NULL CHECK (json_valid(object_ids_json)),
    feedback_thread_id TEXT,
    PRIMARY KEY (board_id, source_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_review_target_snapshots (
    board_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    targets_board_revision INTEGER NOT NULL CHECK (targets_board_revision >= 0),
    targets_json TEXT NOT NULL CHECK (json_valid(targets_json)),
    PRIMARY KEY (board_id, source_id),
    FOREIGN KEY (board_id, source_id)
      REFERENCES board_review_sources (board_id, source_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_suggestions (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    proposal_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    owner_actor_id TEXT NOT NULL,
    observation TEXT NOT NULL,
    proposal_version INTEGER NOT NULL DEFAULT 0 CHECK (proposal_version >= 0),
    created_at_millis INTEGER NOT NULL,
    expires_at_millis INTEGER NOT NULL,
    accepted_option_id TEXT,
    accepted_board_revision INTEGER,
    rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
    PRIMARY KEY (board_id, proposal_id),
    FOREIGN KEY (board_id, source_id)
      REFERENCES board_review_sources (board_id, source_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS board_suggestions_feed
    ON board_suggestions (board_id, created_at_millis DESC, proposal_id DESC);
  CREATE TABLE IF NOT EXISTS board_suggestion_options (
    board_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    option_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    edit_kind TEXT NOT NULL CHECK (edit_kind IN ('geometry', 'content')),
    edit_bytes BLOB NOT NULL,
    edit_fingerprint TEXT NOT NULL,
    planned_fingerprint TEXT NOT NULL,
    PRIMARY KEY (board_id, proposal_id, option_id),
    UNIQUE (board_id, proposal_id, position),
    FOREIGN KEY (board_id, proposal_id)
      REFERENCES board_suggestions (board_id, proposal_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS board_suggestion_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'submit', 'reject')),
    target_id TEXT NOT NULL,
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
function optionalText(value, field) {
  return value === null ? void 0 : storedText(value, field);
}
function decodeReviewTarget(value) {
  const { objectId, kind, geometryVersion, payloadVersion, geometry } = storedRecord(
    value,
    "review_target"
  );
  const { x, y, width, height, rotation } = storedRecord(geometry, "review_target_geometry");
  return {
    objectId: storedText(objectId, "object_id"),
    kind: storedText(kind, "kind"),
    geometryVersion: storedDecimalVersion(geometryVersion, "geometry_version"),
    payloadVersion: payloadVersion === void 0 ? void 0 : storedDecimalVersion(payloadVersion, "payload_version"),
    geometry: {
      x: storedNumber(x, "x"),
      y: storedNumber(y, "y"),
      width: storedNumber(width, "width"),
      height: storedNumber(height, "height"),
      rotation: storedNumber(rotation, "rotation")
    }
  };
}
function readSource(connection, boardId, sourceId) {
  const query = connection.prepare(`
    SELECT sources.*, snapshots.targets_board_revision, snapshots.targets_json
    FROM board_review_sources AS sources
    LEFT JOIN board_review_target_snapshots AS snapshots USING (board_id, source_id)
    WHERE sources.board_id = ? AND sources.source_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, sourceId);
  if (!row) {
    return void 0;
  }
  return {
    boardId,
    sourceId,
    ownerActorId: storedText(row.owner_actor_id, "owner_actor_id"),
    capturedBoardRevision: storedVersion(row.board_revision, "board_revision"),
    objectIds: storedArray(
      decodeJson(row.object_ids_json, "object_ids_json"),
      "object_ids_json"
    ).map((id) => storedText(id, "object_id")),
    feedbackThreadId: optionalText(row.feedback_thread_id, "feedback_thread_id"),
    targets: row.targets_json === null ? [] : storedArray(decodeJson(row.targets_json, "targets_json"), "targets_json").map(
      decodeReviewTarget
    ),
    targetsBoardRevision: row.targets_board_revision === null ? void 0 : storedVersion(row.targets_board_revision, "targets_board_revision")
  };
}
function metadataFromRow(row) {
  return {
    proposalId: storedText(row.proposal_id, "proposal_id"),
    sourceId: storedText(row.source_id, "source_id"),
    observation: storedText(row.observation, "observation"),
    proposalVersion: storedVersion(row.proposal_version, "proposal_version"),
    expiresAtMillis: storedVersion(row.expires_at_millis, "expires_at_millis"),
    acceptedOptionId: optionalText(row.accepted_option_id, "accepted_option_id"),
    acceptedBoardRevision: row.accepted_board_revision === null ? void 0 : storedVersion(row.accepted_board_revision, "accepted_board_revision"),
    rejected: storedSqliteBool(row.rejected, "rejected")
  };
}
function optionMetadata(row) {
  return {
    optionId: storedText(row.option_id, "option_id"),
    label: storedText(row.label, "label"),
    description: optionalText(row.description, "description")
  };
}
function decodeOption(row) {
  const kind = storedText(row.edit_kind, "edit_kind");
  const bytes = row.edit_bytes;
  if (kind !== "geometry" && kind !== "content" || !(bytes instanceof Uint8Array)) {
    throw new Error("A saved board suggestion option has an invalid typed edit.");
  }
  return {
    ...optionMetadata(row),
    edit: { kind, bytes },
    editFingerprint: storedText(row.edit_fingerprint, "edit_fingerprint"),
    plannedFingerprint: storedText(row.planned_fingerprint, "planned_fingerprint")
  };
}
function readProposal(connection, boardId, proposalId) {
  const query = connection.prepare(`
    SELECT * FROM board_suggestions WHERE board_id = ? AND proposal_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId, proposalId);
  if (!row) {
    return void 0;
  }
  const options = connection.prepare(
    `SELECT * FROM board_suggestion_options WHERE board_id = ? AND proposal_id = ? ORDER BY position`
  ).all(boardId, proposalId).map(decodeOption);
  return {
    ...metadataFromRow(row),
    boardId,
    ownerActorId: storedText(row.owner_actor_id, "owner_actor_id"),
    createdAtMillis: storedVersion(row.created_at_millis, "created_at_millis"),
    options
  };
}
function listProposals(connection, boardId, nowMillis, limit, beforeProposalId) {
  const query = connection.prepare(`
    SELECT * FROM board_suggestions
    WHERE board_id = ? AND expires_at_millis > ?
      AND (? IS NULL OR (created_at_millis, proposal_id) <
        (SELECT created_at_millis, proposal_id FROM board_suggestions
          WHERE board_id = ? AND proposal_id = ?))
    ORDER BY created_at_millis DESC, proposal_id DESC LIMIT ?
  `);
  query.setReadBigInts(true);
  const cursor = beforeProposalId ?? null;
  const rows = query.all(boardId, nowMillis, cursor, boardId, cursor, limit);
  const options = connection.prepare(`
    SELECT option_id, label, description FROM board_suggestion_options
    WHERE board_id = ? AND proposal_id = ? ORDER BY position
  `);
  return rows.map((row) => {
    const proposal = metadataFromRow(row);
    return {
      ...proposal,
      options: options.all(boardId, proposal.proposalId).map(optionMetadata)
    };
  });
}
function readReceipt3(connection, boardId, actorId2, commandId) {
  const row = connection.prepare(`
    SELECT signature, kind, target_id FROM board_suggestion_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `).get(boardId, actorId2, commandId);
  if (!row) {
    return void 0;
  }
  const kind = storedText(row.kind, "kind");
  if (kind !== "source" && kind !== "submit" && kind !== "reject") {
    throw new Error("A saved board suggestion receipt has an invalid action.");
  }
  return {
    kind,
    signature: storedText(row.signature, "signature"),
    targetId: storedText(row.target_id, "target_id")
  };
}
function createSuggestionQueries(connection) {
  return {
    canReviewBoard(boardId, actorId2) {
      const access = readBoardAccess(connection, boardId, actorId2);
      return access?.isOwner === true && access.canEdit;
    },
    getReviewSource: (boardId, sourceId) => readSource(connection, boardId, sourceId),
    getSuggestion: (boardId, proposalId) => readProposal(connection, boardId, proposalId),
    listSuggestions: (boardId, now, limit, cursor) => listProposals(connection, boardId, now, limit, cursor),
    getSuggestionReceipt: (boardId, actorId2, commandId) => readReceipt3(connection, boardId, actorId2, commandId)
  };
}
function insertSource(connection, source) {
  connection.prepare(`
      INSERT INTO board_review_sources (
        board_id, source_id, owner_actor_id, board_revision, object_ids_json, feedback_thread_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
    source.boardId,
    source.sourceId,
    source.ownerActorId,
    source.capturedBoardRevision,
    JSON.stringify(source.objectIds),
    source.feedbackThreadId ?? null
  );
  if (source.targetsBoardRevision === void 0) {
    throw new Error("A new board review source requires a frozen target revision.");
  }
  const targets = JSON.stringify(
    source.targets,
    (_key, value) => typeof value === "bigint" ? value.toString() : value
  );
  connection.prepare(`
      INSERT INTO board_review_target_snapshots (
        board_id, source_id, targets_board_revision, targets_json
      ) VALUES (?, ?, ?, ?)
    `).run(source.boardId, source.sourceId, source.targetsBoardRevision, targets);
}
function insertOptions(connection, proposal) {
  const insert = connection.prepare(`
    INSERT INTO board_suggestion_options (
      board_id, proposal_id, option_id, position, label, description,
      edit_kind, edit_bytes, edit_fingerprint, planned_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [position, option] of proposal.options.entries()) {
    insert.run(
      proposal.boardId,
      proposal.proposalId,
      option.optionId,
      position,
      option.label,
      option.description ?? null,
      option.edit.kind,
      option.edit.bytes,
      option.editFingerprint,
      option.plannedFingerprint
    );
  }
}
function insertProposal(connection, proposal) {
  connection.prepare(`
      INSERT INTO board_suggestions (
        board_id, proposal_id, source_id, owner_actor_id, observation,
        created_at_millis, expires_at_millis
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
    proposal.boardId,
    proposal.proposalId,
    proposal.sourceId,
    proposal.ownerActorId,
    proposal.observation,
    proposal.createdAtMillis,
    proposal.expiresAtMillis
  );
  insertOptions(connection, proposal);
}
function updateProposal(connection, proposal) {
  const update2 = connection.prepare(`
    UPDATE board_suggestions
    SET proposal_version = ?, accepted_option_id = ?, accepted_board_revision = ?, rejected = ?
    WHERE board_id = ? AND proposal_id = ? AND proposal_version = ?
  `);
  const result = update2.run(
    proposal.proposalVersion,
    proposal.acceptedOptionId ?? null,
    proposal.acceptedBoardRevision ?? null,
    Number(proposal.rejected),
    proposal.boardId,
    proposal.proposalId,
    proposal.proposalVersion - 1n
  );
  if (Number(result.changes) !== 1) {
    throw new Error("The whiteboard suggestion state changed before it could be saved.");
  }
}
function createSuggestionMutations(connection) {
  return {
    createReviewSource: (source) => insertSource(connection, source),
    createSuggestion: (proposal) => insertProposal(connection, proposal),
    decideSuggestion: (proposal) => updateProposal(connection, proposal),
    saveSuggestionReceipt(boardId, actorId2, commandId, receipt) {
      connection.prepare(`
          INSERT INTO board_suggestion_receipts (
            board_id, actor_id, command_id, signature, kind, target_id
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(boardId, actorId2, commandId, receipt.signature, receipt.kind, receipt.targetId);
    }
  };
}

// src/infrastructure/adapters/index.ts
var sceneFields = `
  SELECT o.object_id, o.kind, o.label, o.x, o.y, o.width, o.height, o.rotation,
         o.geometry_version, p.payload_version, o.locked, o.parent_id, o.group_id,
         o.appearance_json, o.detail_json
`;
var payloadVersionJoin = `
  LEFT JOIN object_payloads AS p INDEXED BY object_payloads_versions
    ON p.board_id = o.board_id AND p.object_id = o.object_id
`;
var sceneOrder = "ORDER BY o.layer_index, o.object_id";
var scopedScene = `
  ${sceneFields}
  FROM board_objects AS o
  ${payloadVersionJoin}
  WHERE o.board_id = ?
`;
var listScene = `${scopedScene} ${sceneOrder}`;
var listGroup = `${scopedScene} AND o.group_id = ? ${sceneOrder}`;
var listChildren = `${scopedScene} AND o.parent_id = ? ${sceneOrder}`;
var listTargets = `
  ${sceneFields}
  FROM (SELECT DISTINCT value AS object_id FROM json_each(?)) AS target
  CROSS JOIN board_objects AS o ON o.board_id = ? AND o.object_id = target.object_id
  ${payloadVersionJoin}
  ${sceneOrder}
`;
function readObjects(connection, statement, ...params) {
  const query = connection.prepare(statement);
  query.setReadBigInts(true);
  return query.all(...params).map(decodeSceneObject);
}
function readBoard2(connection, boardId) {
  const query = connection.prepare("SELECT title, revision FROM boards WHERE board_id = ?");
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row) {
    return void 0;
  }
  return {
    boardId,
    title: storedText(row.title, "title"),
    revision: storedVersion(row.revision, "revision")
  };
}
function readPayloads(connection, boardId, objectIds) {
  if (objectIds.length === 0) {
    return [];
  }
  const query = connection.prepare(`
    SELECT object_id, payload_version, body_kind, body_json
    FROM object_payloads
    WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))
  `);
  query.setReadBigInts(true);
  return query.all(boardId, JSON.stringify(objectIds)).map((row) => ({
    objectId: storedText(row.object_id, "object_id"),
    payloadVersion: storedVersion(row.payload_version, "payload_version"),
    bodyKind: storedText(row.body_kind, "body_kind"),
    data: decodePayload(row.body_json)
  }));
}
function readPayloadByteSize(connection, boardId, objectIds, revision) {
  if (revision !== void 0) {
    return readVersionPayloadByteSize(connection, boardId, revision, objectIds);
  }
  if (objectIds.length === 0) {
    return 0n;
  }
  const query = connection.prepare(`
    SELECT coalesce(sum(length(cast(body_json AS BLOB))), 0) AS total_bytes
    FROM object_payloads
    WHERE board_id = ? AND object_id IN (SELECT value FROM json_each(?))
  `);
  query.setReadBigInts(true);
  return storedVersion(query.get(boardId, JSON.stringify(objectIds))?.total_bytes, "total_bytes");
}
function readExportAsset(connection, boardId, assetId, maximumBytes) {
  const row = connection.prepare(`
      SELECT mime_type, CASE WHEN length(bytes) <= ? THEN bytes END AS bytes
      FROM board_archive_assets
      WHERE board_id = ? AND asset_id = ?
    `).get(maximumBytes, boardId, assetId);
  if (!row) {
    return void 0;
  }
  if (row.bytes === null) {
    return { kind: "tooLarge" };
  }
  if (!(row.bytes instanceof Uint8Array)) {
    throw new Error("Invalid archived asset bytes.");
  }
  return {
    kind: "asset",
    asset: {
      mimeType: storedText(row.mime_type, "asset mime type"),
      byteLength: row.bytes.byteLength,
      base64: Buffer.from(row.bytes).toString("base64")
    }
  };
}
function readReceipt4(connection, boardId, actorId2, commandId) {
  const row = connection.prepare(`
    SELECT signature, receipt_json
    FROM command_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `).get(boardId, actorId2, commandId);
  if (!row) {
    return void 0;
  }
  const data = storedRecord(decodeJson(row.receipt_json, "receipt_json"), "receipt_json");
  return {
    signature: storedText(row.signature, "signature"),
    receipt: {
      boardId,
      commandId,
      outcome: {
        kind: "applied",
        boardRevision: storedDecimalVersion(data.boardRevision, "boardRevision"),
        objects: storedArray(data.objects, "objects").map(decodeReceiptObject)
      }
    }
  };
}
function saveGeometry(connection, boardId, objects) {
  recordObjectHistory(
    connection,
    boardId,
    objects.map(({ objectId }) => objectId)
  );
  const update2 = connection.prepare(`
    UPDATE board_objects
    SET x = ?, y = ?, detail_json = ?, geometry_version = ?
    WHERE board_id = ? AND object_id = ? AND geometry_version = ?
  `);
  update2.setReadBigInts(true);
  for (const object of objects) {
    const { objectId, geometry, geometryVersion, detail } = object;
    const detailJson = detail === void 0 ? null : JSON.stringify(detail);
    const result = update2.run(
      geometry.x,
      geometry.y,
      detailJson,
      geometryVersion,
      boardId,
      objectId,
      geometryVersion - 1n
    );
    if (result.changes !== 1n) {
      throw new Error("The object geometry changed before the transaction updated it.");
    }
  }
}
function saveReceipt2(connection, actorId2, stored) {
  const { boardId, commandId, outcome } = stored.receipt;
  if (outcome.kind !== "applied") {
    throw new Error("Only applied commands have a durable receipt.");
  }
  const receiptJson = JSON.stringify({
    boardRevision: outcome.boardRevision.toString(),
    objects: outcome.objects.map((object) => ({
      ...object,
      geometryVersion: object.geometryVersion.toString(),
      payloadVersion: object.payloadVersion?.toString()
    }))
  });
  connection.prepare(`
    INSERT INTO command_receipts (board_id, actor_id, command_id, signature, receipt_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(boardId, actorId2, commandId, stored.signature, receiptJson);
}
function createReader2(connection) {
  return {
    getAccess: (boardId, actorId2) => {
      const access = readBoardAccess(connection, boardId, actorId2);
      return access && { canEdit: access.canEdit };
    },
    getBoard: (boardId) => readBoard2(connection, boardId),
    listObjects: (boardId, limit) => limit === void 0 ? readObjects(connection, listScene, boardId) : readObjects(connection, listScene + " LIMIT ?", boardId, limit),
    getObjects: (boardId, objectIds) => objectIds.length === 0 ? [] : readObjects(connection, listTargets, JSON.stringify(objectIds), boardId),
    getPayloads: (boardId, objectIds) => readPayloads(connection, boardId, objectIds),
    payloadByteSize: (boardId, ids, revision) => readPayloadByteSize(connection, boardId, ids, revision),
    getExportAsset: (boardId, assetId, maximumBytes) => readExportAsset(connection, boardId, assetId, maximumBytes),
    getReceipt: (boardId, actorId2, commandId) => readReceipt4(connection, boardId, actorId2, commandId),
    getEditReceipt: (boardId, actorId2, commandId) => readEditReceipt(connection, boardId, actorId2, commandId),
    listVersions: (boardId, before, limit) => readBoardVersions(connection, boardId, before, limit),
    getVersion: (boardId, revision) => readBoardVersion(connection, boardId, revision),
    listVersionObjects: (boardId, revision, objectIds) => readVersionObjects(connection, boardId, revision, objectIds),
    getVersionPayloads: (boardId, revision, objectIds) => readVersionPayloads(connection, boardId, revision, objectIds)
  };
}
function readRelatedConnectors(connection, boardId, ids) {
  if (!ids.length) {
    return [];
  }
  const query = `
    WITH attached AS (
      SELECT connector.object_id
      FROM json_each(?) AS target
      CROSS JOIN board_objects AS connector INDEXED BY board_connector_start
        ON connector.board_id = ? AND connector.kind = 'connector'
        AND json_extract(connector.detail_json, '$.start.attachment.objectId') = target.value
      UNION
      SELECT connector.object_id
      FROM json_each(?) AS target
      CROSS JOIN board_objects AS connector INDEXED BY board_connector_end
        ON connector.board_id = ? AND connector.kind = 'connector'
        AND json_extract(connector.detail_json, '$.end.attachment.objectId') = target.value
    )
    ${sceneFields}
    FROM attached
    CROSS JOIN board_objects AS o ON o.board_id = ? AND o.object_id = attached.object_id
    ${payloadVersionJoin}
    ${sceneOrder}
  `;
  const targets = JSON.stringify(ids);
  return readObjects(connection, query, targets, boardId, targets, boardId, boardId);
}
function createPlanningReader(connection) {
  const reader2 = createReader2(connection);
  return {
    ...reader2,
    listGroupObjects: (boardId, groupId) => readObjects(connection, listGroup, boardId, groupId),
    listChildObjects: (boardId, parentId) => readObjects(connection, listChildren, boardId, parentId),
    hasUsedObjectId: (boardId, objectId) => hasUsedObjectId(connection, boardId, objectId),
    listRelatedConnectors: (boardId, ids) => readRelatedConnectors(connection, boardId, ids)
  };
}
function createWriter(connection) {
  const reader2 = createPlanningReader(connection);
  return {
    ...reader2,
    saveGeometry: (boardId, objects) => saveGeometry(connection, boardId, objects),
    advanceBoardRevision(boardId, commit) {
      const before = commit ? readBoard2(connection, boardId) : void 0;
      const revision = advanceBoardRevision(connection, boardId);
      if (before && commit) {
        publishBoardVersion(connection, before, revision, commit);
      }
      return revision;
    },
    saveReceipt: (actorId2, stored) => saveReceipt2(connection, actorId2, stored),
    applyBoardChanges: (board, changes, commit) => applyBoardChanges(
      connection,
      board,
      changes,
      commit,
      (ids) => reader2.getObjects(board.boardId, ids)
    ),
    saveEditReceipt: (actorId2, stored) => saveEditReceipt(connection, actorId2, stored)
  };
}
function createWhiteboardRepository(database) {
  database.write((connection) => {
    connection.exec(whiteboardSchema);
    connection.exec(boardEditSchema);
    connection.exec(boardHistorySchema);
  });
  return {
    read: (work) => database.read((connection) => work(createReader2(connection))),
    write: (work) => database.write((connection) => work(createWriter(connection)))
  };
}
function createBoardSuggestionRepository(database) {
  database.write((connection) => connection.exec(boardSuggestionsSchema));
  return {
    read: (work) => database.read(
      (connection) => work({ ...createPlanningReader(connection), ...createSuggestionQueries(connection) })
    ),
    write: (work) => database.write(
      (connection) => work({
        ...createWriter(connection),
        ...createSuggestionQueries(connection),
        ...createSuggestionMutations(connection)
      })
    )
  };
}

// src/infrastructure/adapters/rooms/receipts.ts
function readPhase(value) {
  switch (value) {
    case "idle":
    case "running":
    case "paused":
    case "ended":
      return value;
    default:
      throw new Error("Invalid room timer receipt phase");
  }
}
function readReceipt5(connection, actorId2, key) {
  const query = connection.prepare(`
    SELECT signature, version, duration_ms, phase, deadline_ms, remaining_ms
    FROM board_room_timer_receipts
    WHERE board_id = ? AND actor_id = ? AND command_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(key.boardId, actorId2, key.commandId);
  if (!row) {
    return void 0;
  }
  const { signature, version, duration_ms: duration, remaining_ms: remaining } = row;
  const enoughData = typeof duration === "bigint" && typeof remaining === "bigint";
  if (typeof signature !== "string" || typeof version !== "bigint" || !enoughData) {
    throw new Error("Invalid saved room timer receipt");
  }
  const timer = {
    version,
    durationMs: Number(duration),
    phase: readPhase(row.phase),
    deadlineUnixMs: typeof row.deadline_ms === "bigint" ? Number(row.deadline_ms) : void 0,
    remainingMs: Number(remaining)
  };
  return { signature, receipt: { ...key, outcome: { kind: "applied", timer } } };
}
function storeReceipt(connection, actorId2, { receipt, signature }) {
  if (receipt.outcome.kind !== "applied") {
    throw new Error("Only applied room timer receipts may be saved");
  }
  const {
    boardId,
    commandId,
    outcome: { timer }
  } = receipt;
  connection.prepare(`
    INSERT INTO board_room_timer_receipts
      (board_id, actor_id, command_id, signature, version, duration_ms, phase, deadline_ms, remaining_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    boardId,
    actorId2,
    commandId,
    signature,
    timer.version,
    timer.durationMs,
    timer.phase,
    timer.deadlineUnixMs ?? null,
    timer.remainingMs
  );
}

// src/infrastructure/adapters/rooms/index.ts
var schema = `
  CREATE TABLE IF NOT EXISTS board_room_timers (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1000 AND 5999000),
    deadline_ms INTEGER CHECK (deadline_ms >= 0),
    paused_ms INTEGER CHECK (paused_ms BETWEEN 0 AND 5999000),
    CHECK (deadline_ms IS NULL OR paused_ms IS NULL)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_room_timer_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 1000 AND 5999000),
    phase TEXT NOT NULL CHECK (phase IN ('idle', 'running', 'paused', 'ended')),
    deadline_ms INTEGER CHECK (deadline_ms >= 0),
    remaining_ms INTEGER NOT NULL CHECK (remaining_ms BETWEEN 0 AND 5999000),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;
function readAccess(connection, membership, boardId, actorId2) {
  const authorized = membership(connection, boardId, actorId2);
  if (!authorized) {
    return void 0;
  }
  const query = connection.prepare("SELECT revision FROM boards WHERE board_id = ?");
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row || typeof row.revision !== "bigint") {
    return void 0;
  }
  const { canEdit, isOwner, role, name } = authorized;
  const fallbackRole = canEdit ? "editor" : "viewer";
  return {
    boardRevision: row.revision,
    canEdit,
    role: role ?? (isOwner ? "owner" : fallbackRole),
    displayName: name?.trim() || (isOwner ? "\u623F\u4E3B" : actorId2)
  };
}
function readTimer(connection, boardId) {
  const query = connection.prepare(`
    SELECT version, duration_ms, deadline_ms, paused_ms FROM board_room_timers WHERE board_id = ?
  `);
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (!row) {
    return void 0;
  }
  const { version, duration_ms: duration, deadline_ms: deadline, paused_ms: paused } = row;
  if (typeof version !== "bigint" || typeof duration !== "bigint") {
    throw new Error("Invalid saved room timer");
  }
  return {
    version,
    durationMs: Number(duration),
    deadlineUnixMs: typeof deadline === "bigint" ? Number(deadline) : void 0,
    pausedRemainingMs: typeof paused === "bigint" ? Number(paused) : void 0
  };
}
function saveTimer(connection, boardId, state) {
  connection.prepare(`
    INSERT INTO board_room_timers (board_id, version, duration_ms, deadline_ms, paused_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(board_id) DO UPDATE SET
      version = excluded.version, duration_ms = excluded.duration_ms,
      deadline_ms = excluded.deadline_ms, paused_ms = excluded.paused_ms
  `).run(
    boardId,
    state.version,
    state.durationMs,
    state.deadlineUnixMs ?? null,
    state.pausedRemainingMs ?? null
  );
}
function reader(connection, membership) {
  return {
    access: (boardId, actorId2) => readAccess(connection, membership, boardId, actorId2),
    timer: (boardId) => readTimer(connection, boardId),
    receipt: (actorId2, key) => readReceipt5(connection, actorId2, key)
  };
}
function writer(connection, membership) {
  return {
    ...reader(connection, membership),
    saveTimer: (boardId, state) => saveTimer(connection, boardId, state),
    saveReceipt: (actorId2, stored) => storeReceipt(connection, actorId2, stored)
  };
}
function createRoomsRepository(database, membership) {
  database.write((connection) => connection.exec(schema));
  return {
    read: (work) => database.read((connection) => work(reader(connection, membership))),
    write: (work) => database.write((connection) => work(writer(connection, membership)))
  };
}

// src/infrastructure/adapters/sharing/reader.ts
function findRows(connection, sql, ...args) {
  const query = connection.prepare(sql);
  query.setReadBigInts(true);
  return query.all(...args);
}
function findRow(connection, sql, ...args) {
  const query = connection.prepare(sql);
  query.setReadBigInts(true);
  return query.get(...args);
}
function readText2(value, field) {
  if (typeof value !== "string") {
    throw new Error("Invalid stored sharing text for " + field + ".");
  }
  return value;
}
function readVersion2(value, field) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("Invalid stored sharing version for " + field + ".");
  }
  return value;
}
function readFlag2(value, field) {
  if (value !== 0n && value !== 1n) {
    throw new Error("Invalid stored sharing flag for " + field + ".");
  }
  return value === 1n;
}
function readRole(value) {
  if (value === "editor" || value === "commenter" || value === "viewer") {
    return value;
  }
  throw new Error("Invalid stored guest role.");
}
function readScope2(value) {
  if (value === "local" || value === "lan") {
    return value;
  }
  throw new Error("Invalid stored sharing scope.");
}
function readSettings(row) {
  return {
    enabled: readFlag2(row.enabled, "enabled"),
    scope: readScope2(row.scope),
    version: readVersion2(row.version, "version")
  };
}
function readInvitation2(row) {
  return {
    role: readRole(row.role),
    seed: readText2(row.seed, "seed"),
    enabled: readFlag2(row.enabled, "enabled"),
    version: readVersion2(row.version, "version")
  };
}
function readMember(row) {
  return {
    actorId: readText2(row.actor_id, "actor_id"),
    name: readText2(row.name, "name"),
    nameKey: readText2(row.name_key, "name_key"),
    role: readRole(row.role),
    invitationVersion: readVersion2(row.invitation_version, "invitation_version"),
    removed: readFlag2(row.removed, "removed")
  };
}
function readSession(row) {
  const expiresAt = Number(readVersion2(row.expires_at_millis, "expires_at_millis"));
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error("Invalid browser session expiry.");
  }
  return { actorId: readText2(row.actor_id, "actor_id"), expiresAt };
}
var inviteColumns = "role, seed, enabled, version";
var memberColumns = "actor_id, name, name_key, role, invitation_version, removed";
function createSharingReader(connection) {
  return {
    activeSharingScopes() {
      return findRows(
        connection,
        `
        SELECT DISTINCT s.scope
        FROM board_sharing AS s
        JOIN board_lifecycle AS l ON l.board_id = s.board_id
        JOIN board_members AS m ON m.board_id = s.board_id AND m.actor_id = l.owner_actor_id
        WHERE s.enabled = 1 AND l.trashed_at_millis IS NULL
        ORDER BY s.scope
      `
      ).map(({ scope: scope2 }) => readScope2(scope2));
    },
    getBoard(boardId) {
      const row = findRow(
        connection,
        `
        SELECT b.title FROM boards AS b
        LEFT JOIN board_lifecycle AS l ON l.board_id = b.board_id
        WHERE b.board_id = ? AND l.trashed_at_millis IS NULL
      `,
        boardId
      );
      return row && { boardId, title: readText2(row.title, "title") };
    },
    ownsBoard(boardId, actorId2) {
      return readBoardAccess(connection, boardId, actorId2)?.isOwner === true;
    },
    getSettings(boardId) {
      const row = findRow(
        connection,
        "SELECT enabled, scope, version FROM board_sharing WHERE board_id = ?",
        boardId
      );
      return row && readSettings(row);
    },
    listInvitations(boardId) {
      return findRows(
        connection,
        "SELECT " + inviteColumns + " FROM board_sharing_invites WHERE board_id = ?",
        boardId
      ).map(readInvitation2);
    },
    listMembers(boardId) {
      return findRows(
        connection,
        "SELECT " + memberColumns + " FROM board_sharing_members WHERE board_id = ? ORDER BY name_key, actor_id",
        boardId
      ).map(readMember);
    },
    getMember(boardId, actorId2) {
      const row = findRow(
        connection,
        "SELECT " + memberColumns + " FROM board_sharing_members WHERE board_id = ? AND actor_id = ?",
        boardId,
        actorId2
      );
      return row && readMember(row);
    },
    getInvitation(boardId, role) {
      const row = findRow(
        connection,
        "SELECT " + inviteColumns + " FROM board_sharing_invites WHERE board_id = ? AND role = ?",
        boardId,
        role
      );
      return row && readInvitation2(row);
    },
    findMemberByName(boardId, nameKey) {
      const row = findRow(
        connection,
        "SELECT " + memberColumns + " FROM board_sharing_members WHERE board_id = ? AND name_key = ?",
        boardId,
        nameKey
      );
      return row && readMember(row);
    },
    getBrowserSession(tokenHash) {
      const row = findRow(
        connection,
        "SELECT actor_id, expires_at_millis FROM sharing_browser_sessions WHERE token_hash = ?",
        tokenHash
      );
      return row && readSession(row);
    },
    getActiveGuest: (boardId, actorId2, now) => readActiveBoardGuest(connection, boardId, actorId2, now),
    actorSessionIsActive(actorId2, now) {
      return findRow(
        connection,
        "SELECT 1 FROM sharing_browser_sessions WHERE actor_id = ? AND expires_at_millis > ?",
        actorId2,
        now
      ) !== void 0;
    },
    getReceipt(boardId, actorId2, commandId) {
      const row = findRow(
        connection,
        `
        SELECT signature, version FROM board_sharing_receipts
        WHERE board_id = ? AND actor_id = ? AND command_id = ?
      `,
        boardId,
        actorId2,
        commandId
      );
      if (row) {
        return {
          signature: readText2(row.signature, "signature"),
          receipt: {
            boardId,
            commandId,
            outcome: { kind: "applied", version: readVersion2(row.version, "version") }
          }
        };
      }
    }
  };
}

// src/infrastructure/adapters/sharing/schema.ts
var sharingSchema = `
  CREATE TABLE IF NOT EXISTS board_sharing (
    board_id TEXT PRIMARY KEY REFERENCES boards (board_id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    scope TEXT NOT NULL CHECK (scope IN ('local', 'lan')),
    version INTEGER NOT NULL CHECK (version >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_invites (
    board_id TEXT NOT NULL REFERENCES board_sharing (board_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    version INTEGER NOT NULL CHECK (version >= 0),
    seed TEXT NOT NULL,
    PRIMARY KEY (board_id, role)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sharing_browser_sessions (
    token_hash TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL UNIQUE,
    expires_at_millis INTEGER NOT NULL CHECK (expires_at_millis >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_members (
    board_id TEXT NOT NULL REFERENCES board_sharing (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES sharing_browser_sessions (actor_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
    invitation_version INTEGER NOT NULL CHECK (invitation_version >= 0),
    removed INTEGER NOT NULL CHECK (removed IN (0, 1)),
    PRIMARY KEY (board_id, actor_id),
    UNIQUE (board_id, name_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS board_sharing_receipts (
    board_id TEXT NOT NULL REFERENCES boards (board_id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 0),
    PRIMARY KEY (board_id, actor_id, command_id)
  ) STRICT;
`;

// src/infrastructure/adapters/sharing/index.ts
function createSharingWriter(connection) {
  return {
    ...createSharingReader(connection),
    saveSettings(boardId, { enabled, scope: scope2, version }) {
      connection.prepare(`
        INSERT INTO board_sharing (board_id, enabled, scope, version) VALUES (?, ?, ?, ?)
        ON CONFLICT (board_id) DO UPDATE SET
          enabled = excluded.enabled, scope = excluded.scope, version = excluded.version
      `).run(boardId, Number(enabled), scope2, version);
    },
    saveInvitation(boardId, { role, enabled, version, seed }) {
      connection.prepare(`
        INSERT INTO board_sharing_invites (board_id, role, enabled, version, seed)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (board_id, role) DO UPDATE SET enabled = excluded.enabled,
          version = excluded.version, seed = excluded.seed
      `).run(boardId, role, Number(enabled), version, seed);
    },
    saveMember(boardId, { actorId: actorId2, name, nameKey, role, invitationVersion, removed }) {
      connection.prepare(`
        INSERT INTO board_sharing_members (board_id, actor_id, name, name_key, role, invitation_version, removed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (board_id, actor_id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key,
          role = excluded.role, invitation_version = excluded.invitation_version, removed = excluded.removed
      `).run(boardId, actorId2, name, nameKey, role, invitationVersion, Number(removed));
    },
    deleteMember(boardId, actorId2) {
      connection.prepare("DELETE FROM board_sharing_members WHERE board_id = ? AND actor_id = ?").run(boardId, actorId2);
    },
    saveBrowserSession(tokenHash, { actorId: actorId2, expiresAt }) {
      connection.prepare(`
        INSERT INTO sharing_browser_sessions (token_hash, actor_id, expires_at_millis) VALUES (?, ?, ?)
      `).run(tokenHash, actorId2, expiresAt);
    },
    saveReceipt(actorId2, { signature, receipt }) {
      const { boardId, commandId, outcome } = receipt;
      if (outcome.kind !== "applied") {
        throw new Error("Only applied sharing commands have durable receipts.");
      }
      connection.prepare(`
        INSERT INTO board_sharing_receipts (board_id, actor_id, command_id, signature, version)
        VALUES (?, ?, ?, ?, ?)
      `).run(boardId, actorId2, commandId, signature, outcome.version);
    }
  };
}
function createSharingRepository(database) {
  database.write((connection) => connection.exec(sharingSchema));
  return {
    read: (work) => database.read((connection) => work(createSharingReader(connection))),
    write: (work) => database.write((connection) => work(createSharingWriter(connection)))
  };
}

// src/bootstrap/index.ts
var loopback2 = "127.0.0.1";
var maxPort = 65535;
function digest(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function equalToken(left, right) {
  const supplied = Buffer.from(left);
  const expected = Buffer.from(right);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function listenOnLoopback(server, port) {
  if (!Number.isInteger(port) || port < 0 || port > maxPort) {
    return Promise.reject(new RangeError("The HTTP port must be between 0 and 65535."));
  }
  return new Promise((resolve, reject2) => {
    function handleListenError(error) {
      server.off("listening", handleListening);
      reject2(error);
    }
    function handleListening() {
      server.off("error", handleListenError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject2(new Error("The whiteboard service did not obtain a TCP address."));
        return;
      }
      resolve(new URL("http://" + loopback2 + ":" + address.port));
    }
    server.once("error", handleListenError);
    server.once("listening", handleListening);
    server.listen(port, loopback2);
  });
}
function stopListening(server) {
  return new Promise((resolve, reject2) => {
    server.close((error) => {
      if (error) {
        reject2(error);
      } else {
        resolve();
      }
    });
  });
}
function createWhiteboardServer(options) {
  const database = openSqliteDatabase(options.databasePath);
  let server;
  let httpOptions;
  let rooms;
  let sharing;
  try {
    const repository = createWhiteboardRepository(database);
    const application = createWhiteboardApplication(repository, Date.now);
    const archives = createArchiveImportRepository(database);
    const catalog = createCatalogRepository(database);
    const catalogApplication = createCatalogApplication(catalog, {
      newBoardId: randomUUID,
      now: Date.now
    });
    const archiveApplication = createArchiveImportApplication(archives, {
      newBoardId: randomUUID,
      now: Date.now
    });
    const feedbackRepository = createFeedbackRepository(database);
    const feedback = createFeedbackApplication(feedbackRepository, { now: Date.now, digest });
    const suggestions = createBoardSuggestionApplication(
      createBoardSuggestionRepository(database),
      {
        now: Date.now,
        newId: randomUUID,
        digest,
        readFeedbackSource(actor, boardId, feedbackThreadId) {
          try {
            const { thread } = feedback.getThread(actor, boardId, feedbackThreadId, {
              pageSize: 1
            });
            const anchor = thread.anchor;
            return {
              capturedBoardRevision: anchor.sourceBoardRevision,
              objectId: anchor.target.kind === "object" ? anchor.target.objectId : void 0
            };
          } catch (error) {
            if (error instanceof FeedbackThreadNotFoundError) {
              return void 0;
            }
            throw error;
          }
        }
      }
    );
    const sharingRepository = createSharingRepository(database);
    sharing = createSharingApplication(sharingRepository, {
      now: Date.now,
      digest,
      equalToken,
      newInvitationSeed: () => randomBytes(32).toString("hex"),
      newGuestId: () => "guest-" + randomUUID(),
      inviteOrigin: options.sharing?.inviteOrigin ?? (() => void 0)
    });
    rooms = createRoomsApplication(
      createRoomsRepository(database, readBoardAccess),
      { nowMillis: Date.now },
      randomUUID()
    );
    httpOptions = {
      application,
      catalogApplication,
      archiveApplication,
      features: {
        editor: createBoardEditorApplication(repository, Date.now),
        history: createBoardHistoryApplication(repository, Date.now),
        feedback,
        rooms,
        suggestions,
        digest
      },
      sharing: {
        application: sharing,
        activateScope: options.sharing?.activateScope,
        newBrowserToken: () => randomBytes(32).toString("base64url"),
        onActivationError: options.onError,
        onAccessChanged: (boardId) => rooms.notifyAccessChanged(boardId)
      },
      resolveActor: options.resolveActor,
      agentSuggestionPath: boardSuggestionSubmitPath,
      onError: options.onError
    };
    server = createWhiteboardHttpServer(httpOptions);
  } catch (error) {
    database.close();
    throw error;
  }
  let starting;
  let closing;
  function listen(port = 0) {
    if (closing) {
      return Promise.reject(new Error("The whiteboard service is closed."));
    }
    starting ??= listenOnLoopback(server, port).catch((error) => {
      starting = void 0;
      throw error;
    });
    return starting;
  }
  async function shutDown() {
    try {
      rooms.close();
      if (starting) {
        await starting;
        await stopListening(server);
      }
    } finally {
      database.close();
    }
  }
  function close() {
    closing ??= shutDown();
    return closing;
  }
  return {
    listen,
    close,
    activeSharingScopes: () => sharing.activeSharingScopes(),
    createGuestHandler: (guest) => createWhiteboardRequestHandler(httpOptions, guest)
  };
}

// src/bootstrap/main.ts
var authPrefix = "Bearer ";
var databaseVariable = "LUMING_STUDIO_II_DB";
var actorVariable = "LUMING_STUDIO_II_ACTOR";
var tokenVariable = "LUMING_STUDIO_II_TOKEN";
var agentTokenVariable = "LUMING_STUDIO_II_AGENT_TOKEN";
var portVariable = "LUMING_STUDIO_II_PORT";
var webRootVariable = "LUMING_STUDIO_II_WEB_ROOT";
var lanHostVariable = "LUMING_STUDIO_II_LAN_HOST";
var lanPortVariable = "LUMING_STUDIO_II_LAN_PORT";
var privateAddress = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;
function readSetting(name) {
  const value = process2.env[name];
  if (!value?.trim()) {
    throw new Error("Set " + name + " before starting the whiteboard service.");
  }
  return value;
}
function lanHost() {
  const configured = process2.env[lanHostVariable];
  if (configured) {
    return configured;
  }
  const addresses = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []);
  const available = addresses.find(
    ({ internal, family, address }) => family === "IPv4" && !internal && privateAddress.test(address)
  );
  if (!available) {
    throw new Error("No local network address is available for Studio sharing.");
  }
  return available.address;
}
var actorId = readSetting(actorVariable);
var token = Buffer.from(readSetting(tokenVariable), "utf8");
var agentSecret = process2.env[agentTokenVariable]?.trim();
var agentToken = agentSecret ? Buffer.from(agentSecret, "utf8") : void 0;
function matchesToken(supplied, expected) {
  return expected !== void 0 && supplied.length === expected.length && timingSafeEqual2(supplied, expected);
}
if (matchesToken(token, agentToken)) {
  throw new Error("Studio App and Agent credentials must be distinct.");
}
function reportFailure(error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  process2.stderr.write("Whiteboard request failed (" + name + ").\n");
}
var guestWeb = createGuestWeb({
  loadAssets: () => loadGuestWebAssets(
    process2.env[webRootVariable] ?? fileURLToPath(new URL("../../../web/dist/app/", import.meta.url))
  ),
  lanHost,
  lanPort: Number(process2.env[lanPortVariable] ?? "0"),
  createHandler: (scope2, origin) => runtime.createGuestHandler({ scope: scope2, origin }),
  onError: reportFailure
});
var runtime = createWhiteboardServer({
  databasePath: readSetting(databaseVariable),
  resolveActor(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith(authPrefix)) {
      return void 0;
    }
    const supplied = Buffer.from(header.slice(authPrefix.length), "utf8");
    if (matchesToken(supplied, token)) {
      return { id: actorId, kind: "human" };
    }
    if (matchesToken(supplied, agentToken)) {
      return { id: actorId, kind: "agent" };
    }
    return void 0;
  },
  onError: reportFailure,
  sharing: {
    inviteOrigin: guestWeb.origin,
    activateScope: guestWeb.activate
  }
});
try {
  const address = await runtime.listen(Number(process2.env[portVariable] ?? "0"));
  await Promise.all(
    runtime.activeSharingScopes().map((scope2) => guestWeb.activate(scope2).catch(reportFailure))
  );
  process2.stdout.write(address.origin + "\n");
} catch (error) {
  await runtime.close();
  throw error;
}
async function shutdown() {
  try {
    await guestWeb.close();
  } catch (error) {
    reportFailure(error);
    process2.exitCode = 1;
  }
  await runtime.close();
}
function handleShutdown() {
  shutdown().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process2.stderr.write("Could not stop the whiteboard service. " + message + "\n");
    process2.exitCode = 1;
  });
}
process2.once("SIGINT", handleShutdown);
process2.once("SIGTERM", handleShutdown);
