'use strict';

var ReactExports = require('react');
var useSyncExternalStoreExports = require('use-sync-external-store/shim/with-selector');
var vanilla = require('zustand/vanilla');

var useDebugValue = ReactExports.useDebugValue;
var useSyncExternalStoreWithSelector = useSyncExternalStoreExports.useSyncExternalStoreWithSelector;
function useStoreWithEqualityFn(api, selector, equalityFn) {
  if (selector === void 0) {
    selector = api.getState;
  }
  var slice = useSyncExternalStoreWithSelector(api.subscribe, api.getState, api.getServerState || api.getState, selector, equalityFn);
  useDebugValue(slice);
  return slice;
}
var createWithEqualityFnImpl = function createWithEqualityFnImpl(createState, defaultEqualityFn) {
  var api = vanilla.createStore(createState);
  var useBoundStoreWithEqualityFn = function useBoundStoreWithEqualityFn(selector, equalityFn) {
    if (equalityFn === void 0) {
      equalityFn = defaultEqualityFn;
    }
    return useStoreWithEqualityFn(api, selector, equalityFn);
  };
  Object.assign(useBoundStoreWithEqualityFn, api);
  return useBoundStoreWithEqualityFn;
};
var createWithEqualityFn = function createWithEqualityFn(createState, defaultEqualityFn) {
  return createState ? createWithEqualityFnImpl(createState, defaultEqualityFn) : createWithEqualityFnImpl;
};

exports.createWithEqualityFn = createWithEqualityFn;
exports.useStoreWithEqualityFn = useStoreWithEqualityFn;
