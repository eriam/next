/**
 * Copyright (c) SAGE3 Development Team 2023. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Persistent storage for electron app: used for window position
const Store = require('electron-store');
const uuid = require('uuid');
const genId = uuid.v4;

// Persistent data store to store window postion/size
// stored by default in app.getPath('userData')
// Create a store
const store = new Store({ name: 'bookmark-store' });

// Default ServerList
const defaultBookmarks = [
  {
    name: 'An example server',
    id: genId(),
    url: 'https://server',
  },
];

// Current list of bookmarks
const currentList = store.get('bookmarks', defaultBookmarks);
// Remove JetStream if it exists
const jsIdx = currentList.findIndex((el) => el.url == 'https://jetsage3.cis230038.projects.jetstream-cloud.org');
if (jsIdx > -1) {
  currentList.splice(jsIdx, 1);
}
// Add it back to the store
store.set('bookmarks', currentList);

module.exports = {
  getBookmarks: function () {
    const list = store.get('bookmarks', defaultBookmarks);
    return list;
  },
  addBookmark: function (name, url) {
    const currentList = store.get('bookmarks', defaultBookmarks);
    const idx = currentList.findIndex((el) => el.url == url);
    if (idx > -1) {
      currentList.splice(idx, 1);
    }
    currentList.push({ name, url, id: genId() });
    return store.set('bookmarks', currentList);
  },
  removeBookmark: function (id) {
    const currentList = store.get('bookmarks', defaultBookmarks);
    const idx = currentList.findIndex((el) => el.id == id);
    if (idx > -1) {
      currentList.splice(idx, 1);
    }
    return store.set('bookmarks', currentList);
  },
  clear: function () {
    store.set('bookmarks', defaultBookmarks);
  },
};
