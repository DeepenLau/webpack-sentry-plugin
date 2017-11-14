'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _requestPromise = require('request-promise');

var _requestPromise2 = _interopRequireDefault(_requestPromise);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BASE_SENTRY_URL = 'https://sentry.io/api/0';

var DEFAULT_INCLUDE = /\.js$|\.map$/;
var DEFAULT_TRANSFORM = function DEFAULT_TRANSFORM(filename) {
  return '~/' + filename;
};
var DEFAULT_DELETE_REGEX = /\.map$/;
var DEFAULT_BODY_TRANSFORM = function DEFAULT_BODY_TRANSFORM(version, projects) {
  return { version: version, projects: projects };
};

module.exports = function () {
  function SentryPlugin(options) {
    var _this = this;

    _classCallCheck(this, SentryPlugin);

    // The baseSentryURL option was previously documented to have
    // `/projects` on the end. We now expect the basic API endpoint
    // but remove any `/projects` suffix for backwards compatibility.
    var projectsRegex = /\/projects$/;
    if (options.baseSentryURL) {
      if (projectsRegex.test(options.baseSentryURL)) {
        // eslint-disable-next-line no-console
        console.warn("baseSentryURL with '/projects' suffix is deprecated; " + 'see https://github.com/40thieves/webpack-sentry-plugin/issues/38');
        this.baseSentryURL = options.baseSentryURL.replace(projectsRegex, '');
      } else {
        this.baseSentryURL = options.baseSentryURL;
      }
    } else {
      this.baseSentryURL = BASE_SENTRY_URL;
    }

    this.organizationSlug = options.organization || options.organisation;
    this.projectSlug = options.project;
    if (typeof this.projectSlug === 'string') {
      this.projectSlug = [this.projectSlug];
    }
    this.apiKey = options.apiKey;

    this.releaseBody = options.releaseBody || DEFAULT_BODY_TRANSFORM;
    this.releaseVersion = options.release;

    this.include = options.include || DEFAULT_INCLUDE;
    this.exclude = options.exclude;

    this.filenameTransform = options.filenameTransform || DEFAULT_TRANSFORM;
    this.suppressErrors = options.suppressErrors;
    this.suppressConflictError = options.suppressConflictError;
    this.createReleaseRequestOptions = options.createReleaseRequestOptions || options.requestOptions || {};
    if (_typeof(this.createReleaseRequestOptions) === 'object') {
      this.createReleaseRequestOptions = function () {
        return _this.createReleaseRequestOptions;
      };
    }
    this.uploadFileRequestOptions = options.uploadFileRequestOptions || options.requestOptions || {};
    if (_typeof(this.uploadFileRequestOptions) === 'object') {
      this.uploadFileRequestOptions = function () {
        return _this.uploadFileRequestOptions;
      };
    }
    if (options.requestOptions) {
      // eslint-disable-next-line no-console
      console.warn('requestOptions is deprecated. ' + 'use createReleaseRequestOptions and ' + 'uploadFileRequestOptions instead; ' + 'see https://github.com/40thieves/webpack-sentry-plugin/pull/43');
    }

    this.deleteAfterCompile = options.deleteAfterCompile;
    this.deleteRegex = options.deleteRegex || DEFAULT_DELETE_REGEX;
  }

  _createClass(SentryPlugin, [{
    key: 'apply',
    value: function apply(compiler) {
      var _this2 = this;

      compiler.plugin('after-emit', function (compilation, cb) {
        var errors = _this2.ensureRequiredOptions();

        if (errors) {
          return _this2.handleErrors(errors, compilation, cb);
        }

        var files = _this2.getFiles(compilation);

        if (typeof _this2.releaseVersion === 'function') {
          _this2.releaseVersion = _this2.releaseVersion(compilation.hash);
        }

        if (typeof _this2.releaseBody === 'function') {
          _this2.releaseBody = _this2.releaseBody(_this2.releaseVersion, _this2.projectSlug);
        }

        return _this2.createRelease().then(function () {
          return _this2.uploadFiles(files);
        }).then(function () {
          return cb();
        }).catch(function (err) {
          return _this2.handleErrors(err, compilation, cb);
        });
      });

      compiler.plugin('done', function (stats) {
        if (_this2.deleteAfterCompile) {
          _this2.deleteFiles(stats);
        }
      });
    }
  }, {
    key: 'handleErrors',
    value: function handleErrors(err, compilation, cb) {
      var errorMsg = 'Sentry Plugin: ' + err;
      if (this.suppressErrors || this.suppressConflictError && err.statusCode === 409) {
        compilation.warnings.push(errorMsg);
      } else {
        compilation.errors.push(errorMsg);
      }

      cb();
    }
  }, {
    key: 'ensureRequiredOptions',
    value: function ensureRequiredOptions() {
      if (!this.organizationSlug) {
        return new Error('Must provide organization');
      } else if (!this.projectSlug) {
        return new Error('Must provide project');
      } else if (!this.apiKey) {
        return new Error('Must provide api key');
      } else if (!this.releaseVersion) {
        return new Error('Must provide release version');
      } else {
        return null;
      }
    }
  }, {
    key: 'getFiles',
    value: function getFiles(compilation) {
      var _this3 = this;

      return Object.keys(compilation.assets).map(function (name) {
        if (_this3.isIncludeOrExclude(name)) {
          return { name: name, path: compilation.assets[name].existsAt };
        }
        return null;
      }).filter(function (i) {
        return i;
      });
    }
  }, {
    key: 'isIncludeOrExclude',
    value: function isIncludeOrExclude(filename) {
      var isIncluded = this.include ? this.include.test(filename) : true;
      var isExcluded = this.exclude ? this.exclude.test(filename) : false;

      return isIncluded && !isExcluded;
    }

    // eslint-disable-next-line class-methods-use-this

  }, {
    key: 'combineRequestOptions',
    value: function combineRequestOptions(req, requestOptionsFunc) {
      var requestOptions = requestOptionsFunc(req);
      var combined = Object.assign({}, requestOptions, req);
      if (requestOptions.headers) {
        Object.assign(combined.headers, requestOptions.headers, req.headers);
      }
      if (requestOptions.auth) {
        Object.assign(combined.auth, requestOptions.auth, req.auth);
      }
      return combined;
    }
  }, {
    key: 'createRelease',
    value: function createRelease() {
      return (0, _requestPromise2.default)(this.combineRequestOptions({
        url: this.sentryReleaseUrl() + '/',
        method: 'POST',
        auth: {
          bearer: this.apiKey
        },
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.releaseBody)
      }, this.createReleaseRequestOptions));
    }
  }, {
    key: 'uploadFiles',
    value: function uploadFiles(files) {
      return Promise.all(files.map(this.uploadFile.bind(this)));
    }
  }, {
    key: 'uploadFile',
    value: function uploadFile(_ref) {
      var _this4 = this;

      var path = _ref.path,
          name = _ref.name;

      var maxAttempts = this.uploadFileRequestOptions.customMaxRetries || 2;
      var requestApi = function requestApi() {
        return (0, _requestPromise2.default)(_this4.combineRequestOptions({
          url: _this4.sentryReleaseUrl() + '/' + _this4.releaseVersion + '/files/',
          method: 'POST',
          auth: {
            bearer: _this4.apiKey
          },
          headers: {},
          formData: {
            file: _fs2.default.createReadStream(path),
            name: _this4.filenameTransform(name)
          }
        }, _this4.uploadFileRequestOptions)).catch(function (err) {
          if (maxAttempts <= 0) {
            return Promise.reject(err);
          }
          maxAttempts--; // eslint-disable-line
          return requestApi();
        });
      };
      return requestApi();
    }

    // uploadFile({ path, name }) {
    //   return request(
    //     this.combineRequestOptions(
    //       {
    //         url: `${this.sentryReleaseUrl()}/${this.releaseVersion}/files/`,
    //         method: 'POST',
    //         auth: {
    //           bearer: this.apiKey,
    //         },
    //         headers: {},
    //         formData: {
    //           file: fs.createReadStream(path),
    //           name: this.filenameTransform(name),
    //         },
    //       },
    //       this.uploadFileRequestOptions,
    //     ),
    //   )
    // }

  }, {
    key: 'sentryReleaseUrl',
    value: function sentryReleaseUrl() {
      return this.baseSentryURL + '/organizations/' + this.organizationSlug + '/releases';
    }
  }, {
    key: 'deleteFiles',
    value: function deleteFiles(stats) {
      var _this5 = this;

      Object.keys(stats.compilation.assets).filter(function (name) {
        return _this5.deleteRegex.test(name);
      }).forEach(function (name) {
        var existsAt = stats.compilation.assets[name].existsAt;

        _fs2.default.unlinkSync(existsAt);
      });
    }
  }]);

  return SentryPlugin;
}();