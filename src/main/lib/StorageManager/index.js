const sander = require('sander')
const path = require('path')
const PouchDB = require('pouchdb')
const { OrderedMap, Map, Set } = require('immutable')
const util = require('../util')

const electron = require('electron')
const { remote } = electron

const storagesPath = path.join(remote.app.getPath('userData'), 'storages')

let dbs

/**
 * !!TEST IS NEEDED!!
 */

/**
 * Initialize db connection
 * If nothing is found, add a new connection
 *
 * @return {OrderedMap} All DB connections
 */
export function init () {
  let dirNames
  try {
    dirNames = sander.readdirSync(storagesPath)
  } catch (err) {
    // If `storages` doesn't exist, create it.
    if (err.code === 'ENOENT') {
      dirNames = sander.mkdirSync(storagesPath)
    } else throw err
  }
  // If `storages/notebook` doesn't exist, create it.
  if (!dirNames.some((dirName) => dirName === 'notebook')) {
    dirNames.unshift(path.join(storagesPath, 'notebook'))
  }

  dbs = dirNames.reduce(function (map, name) {
    return map.set(name, new PouchDB(path.join(storagesPath, name)))
  }, new OrderedMap())

  return dbs
}

init()

export function list () {
  if (dbs == null) return init()
  return Promise.resolve(new OrderedMap(dbs))
}

const NOTE_ID_PREFIX = 'note:'
const FOLDER_ID_PREFIX = 'folder:'
const isNoteId = new RegExp(`^${NOTE_ID_PREFIX}.+`)
const isFolderId = new RegExp(`^${FOLDER_ID_PREFIX}.+`)

/**
 * load dataMap from a storage
 *
 * @param  {String} name [description]
 * @return {Map} return data map of a Storage
 * including `notes` and `folders` field
 */
export function load (name) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))

  return db
    .allDocs({include_docs: true})
    .then((data) => {
      let { notes, folders } = data.rows.reduce((sum, row) => {
        if (isNoteId.test(row.id)) {
          let noteId = row.id.substring(NOTE_ID_PREFIX.length)
          sum.notes.push([noteId, new Map({
            folder: row.doc.folder,
            titile: row.doc.title,
            content: row.doc.content,
            tags: new Set(row.doc.tags)
          })])
        } else if (isFolderId.test(row.id)) {
          let folderPath = row.id.substring(FOLDER_ID_PREFIX.length)
          sum.folders.push([folderPath, new Map({
            notes: new Set()
          })])
        }
        return sum
      }, {
        notes: [],
        folders: []
      })
      let noteMap = new Map(notes)
      let folderMap = new Map(folders)

      noteMap.forEach((note, noteId) => {
        folderMap = folderMap.updateIn(
          [note.get('folder'), 'notes'],
          noteSet => {
            if (noteSet == null) return new Set([noteId])
            return noteSet.add(noteId)
          }
        )
      })

      // Each repository should have `Notes` folder by default.
      if (!folderMap.has('Notes')) {
        folderMap = folderMap.set('Notes', new Map({
          notes: new Set()
        }))
      }

      return new Map([
        ['notes', noteMap],
        ['folders', folderMap]
      ])
    })
}
/**
 * load dataMaps from all storages and map them
 *
 * @return {OrderedMap} Data Map of all storages
 */
export function loadAll () {
  const promises = dbs
    .keySeq()
    .map((name) => {
      return load(name)
        // struct tuple
        .then((dataMap) => [name, dataMap])
    })
    // Promise.all only understands array
    .toArray()

  return Promise.all(promises)
    // destruct tuple
    .then((storageMap) => new OrderedMap(storageMap))
}

export function upsertFolder (name, folderName) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))
  return db
    .put({
      _id: 'folder:' + folderName
    })
}

export function deleteFolder (name, folderName) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))
  return db.get('folder:' + folderName)
    .then((doc) => {
      doc._deleted = true
      return db.put(doc)
    })
}

export function createNote (name, payload) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))

  function genNoteId () {
    let id = 'note:' + util.randomBytes()
    return db.get(id)
      .then((doc) => {
        if (doc == null) return id
        return genNoteId()
      })
      .catch((err) => {
        if (err.name === 'not_found') return id
        throw err
      })
  }

  return genNoteId()
    .then((noteId) => {
      return db
        .put(Object.assign({}, payload, {
          _id: noteId
        }))
    })
}

export function updateNote (name, noteId, payload) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))

  return db.get(noteId)
    .then((doc) => {
      return db
        .put({}, doc, payload, {
          _id: doc._id,
          _rev: doc._rev
        })
    })
}

export function deleteNote (name, noteId) {
  const db = dbs.get(name)
  if (db == null) return Promise.reject(new Error('DB doesn\'t exist.'))

  return db.get(noteId)
    .then((doc) => {
      return db
        .remove(doc)
    })
}

export default {
  init,
  list,
  load,
  loadAll,
  upsertFolder,
  deleteFolder,
  createNote,
  updateNote,
  deleteNote
}
