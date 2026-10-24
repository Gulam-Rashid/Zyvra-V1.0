/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "zyvra-logo.svg",
    "revision": "cb3d735c9e08d26ab4381d0923f58092"
  }, {
    "url": "registerSW.js",
    "revision": "402b66900e731ca748771b6fc5e7a068"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "6de8b65dccfaf2c40fac99cb371e357d"
  }, {
    "url": "pwa-512x512.png",
    "revision": "921458ac4aaeba3f64abaebdcb0652bc"
  }, {
    "url": "pwa-192x192.png",
    "revision": "a9455e5210f59674e3369ae1362f9d65"
  }, {
    "url": "index.html",
    "revision": "bb47f6c892458d72c3963e9c921c5419"
  }, {
    "url": "icon.svg",
    "revision": "11ee4349f9192047fd07c66407d26022"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "6503055a773b4a8fa40b33a24070e601"
  }, {
    "url": "404.html",
    "revision": "163e063129b447b274a8ab2108b96af2"
  }, {
    "url": "templates/sample-questions.json",
    "revision": "1ea4c999e60e1deabc69252cc6e72a2a"
  }, {
    "url": "templates/sample-questions.csv",
    "revision": "c5b931ee600b4972919688aa969e409b"
  }, {
    "url": "assets/index-P4mkYucf.css",
    "revision": null
  }, {
    "url": "assets/index-B-fCD61g.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "6503055a773b4a8fa40b33a24070e601"
  }, {
    "url": "icon.svg",
    "revision": "11ee4349f9192047fd07c66407d26022"
  }, {
    "url": "pwa-192x192.png",
    "revision": "a9455e5210f59674e3369ae1362f9d65"
  }, {
    "url": "pwa-512x512.png",
    "revision": "921458ac4aaeba3f64abaebdcb0652bc"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "6de8b65dccfaf2c40fac99cb371e357d"
  }, {
    "url": "zyvra-logo.svg",
    "revision": "cb3d735c9e08d26ab4381d0923f58092"
  }, {
    "url": "manifest.webmanifest",
    "revision": "1e430859a3254c8b797d748d877f1ebe"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "zyvra-google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "zyvra-gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
