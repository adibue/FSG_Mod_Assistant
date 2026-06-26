/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// Main Program

const superDebugCache = false

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, clipboard, net } = require('electron')

const isPortable = Object.hasOwn(process.env, 'PORTABLE_EXECUTABLE_DIR')
const gotTheLock = app.requestSingleInstanceLock()

if ( !gotTheLock ) { app.quit() }

const { serveIPC }     = require('./lib/modUtilLib.js')
const { funcLib }      = require('./lib/modAssist_func_lib.js')
const { EventEmitter } = require('node:events')
const crypto           = require('node:crypto')
const path             = require('node:path')
const fs               = require('node:fs')
const fsPromise        = require('node:fs/promises')
const Store            = require('electron-store')

serveIPC.log = new (require('./lib/modUtilLib')).ma_logger('modAssist', app, 'assist.log', gotTheLock)
funcLib.general.doBootLog()

serveIPC.l10n           = new (require('./lib/modUtilLib')).translator(null, !app.isPackaged)
serveIPC.l10n.mcVersion = app.getVersion()
serveIPC.icon.tray      = funcLib.general.getPackPathRender('img', 'icon.ico')

const __ = (x) => serveIPC.l10n.syncStringLookup(x)

class queueEmitter extends EventEmitter {}
const modQueueRunner = new queueEmitter()

/**
 * @typedef referenceFunctions
 * @property {function} gameLauncher launch the game
 * @property {function} processModFolders process mod folders
 * @property {function} readGameLog read the game log
 * @property {function} refreshClientModList refresh mod list in client
 * @property {function} refreshTransientStatus refresh status flags in client
 * @property {function} toggleMiniWindow toggle mini window on and off
 */

serveIPC.refFunc = {
	gameLauncher           : funcLib.gameLauncher,
	processModFolders      : processModFolders,
	refreshClientModList   : refreshClientModList,
	refreshTransientStatus : refreshTransientStatus,
	toggleMiniWindow       : toggleMiniWindow,
}

serveIPC.windowLib = new (require('./lib/modAssist_window_lib.js')).windowLib()
serveIPC.log.dangerCallBack = () => { serveIPC.isDebugDanger = true }

serveIPC.isModCacheDisabled = superDebugCache && !(app.isPackaged)

process.on('uncaughtException',  (err, origin) => { funcLib.general.handleUnhandled('exception', err, origin) })
process.on('unhandledRejection', (err, origin) => { funcLib.general.handleUnhandled('rejection', err, origin) })

if ( process.platform === 'win32' && app.isPackaged && gotTheLock && !isPortable ) { funcLib.general.initUpdater() }

funcLib.wizard.initMain()

// const { modFileCollection, modPackChecker, saveFileChecker, savegameTrack, csvFileChecker } = require('./lib/modCheckLib.js')
const { modFileCollection, csvFileChecker, savegameTrack } = require('./lib/modCheckLib.js')
const { parseModFirstPass, parseSaveGame } = require('fs_mod_parser_neon')

const settingDefault = new (require('./lib/modAssist_window_lib.js')).defaultSettings()

serveIPC.isFirstRun = !fs.existsSync(path.join(app.getPath('userData'), 'config.json'))

serveIPC.storeSet         = new Store({schema : settingDefault.defaults, migrations : settingDefault.migrateBase, clearInvalidConfig : true })
serveIPC.storeCache       = new (require('./lib/modUtilLib.js')).modCacheManager(app.getPath('userData'))
serveIPC.storeSites       = new Store({name : 'mod_source_site', migrations : settingDefault.migrateSite, clearInvalidConfig : true})
serveIPC.storeNote        = new Store({name : 'col_notes', clearInvalidConfig : true})
serveIPC.storeHistory     = new Store({name : 'collection_history', clearInvalidConfig : true})
serveIPC.storeLibrary     = new Store({name : 'mod_library', clearInvalidConfig : true})

serveIPC.windowLib.loadSettings()

funcLib.general.doModCacheCheck() // Check and upgrade Mod Cache & Mod Detail Cache

serveIPC.modCollect = new modFileCollection( app.getPath('home'), modQueueRunner )

// MARK: sidebar buttons
ipcMain.on('files:openModHubID', (_, hubID) => { shell.openExternal(funcLib.general.doModHub(hubID)) })
ipcMain.on('files:openModHub',   (_, modID) => {
	const thisMod   = serveIPC.modCollect.modColUUIDToRecord(modID)

	if ( thisMod.modHub.id !== null ) {
		shell.openExternal(funcLib.general.doModHub(thisMod.modHub.id))
	}
})
ipcMain.on('files:openExtSite',  (_, modID) => {
	const thisMod     = serveIPC.modCollect.modColUUIDToRecord(modID)
	const thisModSite = serveIPC.storeSites.get(thisMod.fileDetail.shortName, null)

	if ( thisModSite !== null ) { shell.openExternal(thisModSite) }
})

ipcMain.on('files:openExplore',  (_, modID)    => {
	const thisMod = serveIPC.modCollect.modColUUIDToFolderAndRecord(modID)

	if ( thisMod.mod !== null ) {
		shell.showItemInFolder(path.join(thisMod.folder, path.basename(thisMod.mod.fileDetail.fullPath)))
	}
})

// MARK: file manage
ipcMain.handle('files:list',      (_, mode, mods) => getCopyMoveDelete(mode, mods))
ipcMain.handle('files:list:favs', ()              => getCopyMoveDelete('copyFavs', ...serveIPC.modCollect.getFavoriteCollectionFiles()))
ipcMain.handle('files:drop', async (_, files) => {
	if ( files.length === 1 && files[0].endsWith('.csv') ) {
		new csvFileChecker(files[0]).getInfo().then((results) => {
			serveIPC.windowLib.createNamedWindow('save', {
				collectKey   : null,
				thisSaveGame : results,
			})
		})
		return
	} else if ( files.length === 1 && files[0].endsWith('.json') ) {
		// HANDLE JSON IMPORT
		funcLib.general.importJSON_process(files[0])
		return
	} else if ( files.length === 1 && files[0].endsWith('.zip') ) {
		// Handles ZIP packs, ZIP save game, and finally single ZIP add
		const saveResult = JSON.parse(parseSaveGame(files[0]))
		
		if ( saveResult.isValid ) {
			serveIPC.windowLib.createNamedWindow('save', {
				collectKey   : null,
				thisSaveGame : saveResult,
			})
			return
		}
		// expect [t/f, file list array]
		const quickParseMod = JSON.parse(parseModFirstPass(files[0]))
		return getCopyMoveDelete('import', null, null, files, [quickParseMod.fileDetail.isModPack, quickParseMod.fileDetail.zipFiles])
	}
	return getCopyMoveDelete('import', null, null, files, false)
})

function sendCopyMoveDelete(operation, modIDS) {
	serveIPC.windowLib.sendToValidWindow('main', 'files:operation', operation, getCopyMoveDelete(operation, modIDS))
}

function getCopyMoveDelete(operation, modIDS, multiSource = null, fileList = null, zipImport = false) {
	if ( modIDS === null || modIDS.length !== 0 ) {
		const isHolding = modIDS !== null ? serveIPC.storeNote.get(`${modIDS[0].split('--')[0]}.notes_holding`, false) : false
		return {
			isHoldingPen     : isHolding,
			isZipImport      : zipImport === false ? false : zipImport[0],
			multiDestination : isHolding && ( operation === 'copy' || operation === 'move' ),
			multiSource      : multiSource,
			operation        : operation,
			originCollectKey : modIDS !== null ? modIDS[0].split('--')[0] : '',
			rawFileList      : fileList,
			records          : modIDS !== null ? serveIPC.modCollect.modColUUIDsToRecords(modIDS) : [],
			zipFiles         : zipImport === false || zipImport[0] === false ? null : zipImport[1],
		}
	}
	return null
}

// MARK: folder manage
ipcMain.handle('folders:activate', async (_, CKey) => funcLib.gameSet.change(CKey) )
ipcMain.on('folders:addDirect', (event, potentialFolder, version) => {
	funcLib.processor.addFolderTracking(potentialFolder, version)
	event.sender.send('settings:invalidate')
})
ipcMain.on('folders:addDrop', (_, newFolder) => {
	funcLib.processor.addFolderTracking(newFolder)
	processModFolders()
})
ipcMain.on('folders:add', (notify_import = false) => {
	funcLib.general.showFileDialog({
		defaultPath : serveIPC.path.last ?? app.getPath('home'),
		filterAll   : false,
		parent      : notify_import ? 'importjson' : 'main',
		
		callback    : (result) => {
			const potentialFolder = result.filePaths[0]

			serveIPC.path.last = path.resolve(path.join(potentialFolder, '..'))
			funcLib.processor.addFolderTracking(potentialFolder, null, notify_import)
			if ( notify_import ) {
				serveIPC.windowLib.sendToValidWindow('importjson', 'importjson:folder', {
					folder     : result.filePaths[0],
					collectKey : serveIPC.modCollect.getFolderHash(result.filePaths[0]),
					contents   : fs.readdirSync(result.filePaths[0]).length,
				})
			}
			processModFolders()
		},
	})
})
ipcMain.on('folders:edit',    () => {
	serveIPC.isFoldersEdit = ! serveIPC.isFoldersEdit
	refreshClientModList(false)
	if ( ! serveIPC.isFoldersEdit ) { processModFolders(true) }
})
ipcMain.on('folders:reload', () => { processModFolders(true) })
ipcMain.on('folders:open',   (_, CKey) => { shell.openPath(serveIPC.modCollect.mapCollectionToFolder(CKey)) })
ipcMain.on('folders:remove', (_, CKey) => {
	const folder = serveIPC.modCollect.mapCollectionToFolder(CKey)
	const userChoice = dialog.showMessageBoxSync(serveIPC.windowLib.win.main, {
		cancelId  : 1,
		defaultId : 1,
		message   : `${__('remove_folder_message')}\n\n${folder}`,
		title     : __('remove_folder__title'),
		type      : 'question',

		buttons : [
			serveIPC.__('bad_folder_action_delete'),
			serveIPC.__('save_manage_button_cancel'),
		],
	})

	switch (userChoice) {
		case 0: {
			if ( serveIPC.modFolders.delete(folder) ) {
				serveIPC.log.notice('folder-opts', 'Folder removed from tracking', folder)
				funcLib.prefs.saveFolders()
				serveIPC.modCollect.removeCollection(CKey)
				funcLib.general.toggleFolderDirty()
				refreshClientModList(false)
			} else {
				serveIPC.log.warning('folder-opts', 'Folder NOT removed from tracking', folder)
			}
			break
		}
		default :
			serveIPC.log.info('folder-opts', 'Folder remove canceled', folder)
	}
})
ipcMain.on('folders:alpha', () => {
	const newOrder = []
	const collator = new Intl.Collator()

	for ( const collectKey of serveIPC.modCollect.collections ) {
		newOrder.push({
			collectKey : collectKey,
			name       : serveIPC.modCollect.mapCollectionToName(collectKey),
			path       : serveIPC.modCollect.mapCollectionToFolder(collectKey),
		})
	}

	newOrder.sort((a, b) =>
		collator.compare(a.name, b.name) ||
		collator.compare(a.collectKey, b.collectKey)
	)

	const newModFolders    = new Set()
	const newModSetOrder   = new Set()

	for ( const orderPart of newOrder ) {
		newModFolders.add(orderPart.path)
		newModSetOrder.add(orderPart.collectKey)
	}

	serveIPC.modFolders.modFolders         = newModFolders
	serveIPC.modCollect.newCollectionOrder = newModSetOrder

	funcLib.prefs.saveFolders()

	refreshClientModList(false)
})
ipcMain.on('folders:set', (_, from, to) => {
	const newOrder    = [...serveIPC.modFolders]
	const item        = newOrder.splice(from, 1)[0]

	newOrder.splice(to, 0, item)

	const newSetOrder = newOrder.map((thisPath) => serveIPC.modCollect.mapFolderToCollection(thisPath))

	serveIPC.modFolders                    = new Set(newOrder)
	serveIPC.modCollect.newCollectionOrder = new Set(newSetOrder)

	funcLib.prefs.saveFolders()

	refreshClientModList(false)
})


ipcMain.on('importjson:download', (_, collectKey, uri, unpack) => {
	funcLib.general.importJSON_download(uri, unpack, collectKey)
})


// MARK: i18n
ipcMain.handle('i18n:langList',   () => serveIPC.l10n.getLangList() )
ipcMain.handle('i18n:lang', (_e, newValue = null) => {
	if ( newValue !== null ) {
		serveIPC.l10n.currentLocale = newValue
		serveIPC.storeSet.set('force_lang', serveIPC.l10n.currentLocale)
		serveIPC.windowLib.refreshL10n()
	}
	return serveIPC.l10n.currentLocale
})
ipcMain.handle('i18n:get', async (_, key, version = 25) => {
	switch (key) {
		case 'app_name':
			return serveIPC.l10n.getTextOverride(key, version, { prefix : '<i class="fsico-ma-large"></i>' })
		case 'app_version' :
			return serveIPC.l10n.getTextOverride(key, version, { newText : !app.isPackaged ? app.getVersion().toString() : '' })
		case 'game_icon' :
			return serveIPC.l10n.getTextOverride(key, version, { newText : `<i class="fsico-ver-${funcLib.prefs.ver()}"></i>` })
		case 'game_icon_lg' :
			return serveIPC.l10n.getTextOverride(key, version, { newText : `<i class="fsico-ver-${funcLib.prefs.ver()}"></i>` })
		case 'clean_cache_size' : {
			try {
				const cacheSize = fs.statSync(path.join(app.getPath('userData'), 'mod_cache.json')).size/(1024*1024)
				const iconSize  = fs.statSync(path.join(app.getPath('userData'), 'mod_icons.json')).size/(1024*1024)
				const itemSize  = fs.statSync(path.join(app.getPath('userData'), 'mod_items.json')).size/(1024*1024)
				return serveIPC.l10n.getTextOverride(key, version, { suffix : ` ${cacheSize.toFixed(2)}MB / ${iconSize.toFixed(2)}MB / ${itemSize.toFixed(2)}MB` })
			} catch {
				return serveIPC.l10n.getTextOverride(key, version, { suffix : ' 0.00MB' })
			}
		}
		case 'clear_malware_size' :
			return serveIPC.l10n.getTextOverride(key, version, { newText : `[ ${serveIPC.storeSet.get('suppress_malware', []).join(', ')} ]` })
		default :
			return serveIPC.l10n.getText(key, version)
	}
})


// MARK: collect IPC
ipcMain.handle('collect:bindConflict', () => serveIPC.modCollect.renderBindConflict() )
ipcMain.handle('collect:malware',      () => ({ dangerModsSkip : serveIPC.whiteMalwareList, suppressList : serveIPC.storeSet.get('suppress_malware', []) }))
ipcMain.handle('collect:all',          () => serveIPC.modCollect.toRenderer())
ipcMain.handle('collect:resolveList',  (_, shortName) => serveIPC.modCollect.modVerListFiltered(shortName))
ipcMain.handle('collect:name',         (_, key) => serveIPC.modCollect.mapCollectionToName(key))
ipcMain.handle('mod:modColUUID', (_, fullUUID) => serveIPC.modCollect.renderMod(fullUUID))


// MARK: detail
ipcMain.handle('detail:getMod', async (_, fullUUID) => {
	const thisMod = await serveIPC.modCollect.detailMod(fullUUID)
	if ( thisMod[0] === null ) { return null }
	if ( thisMod[0].includeDetail === 2 ) {
		return thisMod
	}
	return serveIPC.modCollect.getAndUpdateDetail(fullUUID)
})
ipcMain.on('dispatch:detail', (_, thisMod) => { openDetailWindow(thisMod) })

function openDetailWindow(thisMod) {
	const ver = funcLib.prefs.ver() > 17 ? funcLib.prefs.ver() : 19
	return serveIPC.windowLib.createNamedMulti(`detail${ver}`, { queryString : `mod=${thisMod}` })
}


// MARK: compare
ipcMain.on('dispatch:compare', (_, compareArray) => {
	const compareSet = new Set(compareArray)
	openCompareWindow([...compareSet])
})
ipcMain.handle('compare:get', () => Object.fromEntries(serveIPC.compareMap))
ipcMain.handle('compare:clear', () => {
	serveIPC.compareMap.clear()
	return Object.fromEntries(serveIPC.compareMap)
})
ipcMain.handle('compare:remove', (_, compareObj) => {
	serveIPC.compareMap.delete(compareObj)
	return Object.fromEntries(serveIPC.compareMap)
})
function openCompareWindow(compareArray) {
	if ( Array.isArray(compareArray) ) {
		for ( const compareObj of compareArray ) {
			const compareKey = compareObj.internal ? compareObj.key : `${compareObj.source}--${compareObj.key}`
			serveIPC.compareMap.set(compareKey, compareObj)
		}
	}
	const curVer = funcLib.prefs.ver()
	serveIPC.windowLib.raiseOrOpen(`compare${curVer}`, () => {
		serveIPC.windowLib.sendToValidWindow(`compare${curVer}`, 'win:forceRefresh')
	})
}


// MARK: basegame
ipcMain.on('dispatch:basegame', (_, pageObj = { type : null, page : null}) => { openBaseGameWindow(pageObj.type, pageObj.page) })
ipcMain.on('basegame:folder', (_e, folderParts) => {
	const curVer   = funcLib.prefs.ver()
	const gamePath = path.dirname(funcLib.prefs.verGet('game_path', curVer))

	if ( typeof gamePath !== 'string') { return }

	const dataPathParts = gamePath.split(path.sep)
	const dataPath      = path.join(...(dataPathParts[dataPathParts.length - 1] === 'x64' ? dataPathParts.slice(0, -1) : dataPathParts), 'data', ...folderParts)
	
	if ( fs.existsSync(dataPath) ) {
		shell.openPath(dataPath)
	} else {
		serveIPC.log.danger('basegame-browser', 'Could not find specified folder!', dataPath)
	}
})

function openBaseGameWindow(type = null, page = null) {
	const curVersion = funcLib.prefs.ver()
	serveIPC.windowLib.raiseOrOpen(`basegame${curVersion}`, () => {
		serveIPC.windowLib.setWindowURL(
			`basegame${curVersion}`,
			( type === null || page === null ) ? null : { page : page, type : type }
		)
	})
}


// #region context menu
ipcMain.on('context:copy', (event) => {
	const menu = Menu.buildFromTemplate(funcLib.menu.snip_copy())
	menu.popup(BrowserWindow.fromWebContents(event.sender))
})
ipcMain.on('context:cutCopyPaste', (event) => {
	const menu = Menu.buildFromTemplate(funcLib.menu.snip_cut_copy_paste())
	menu.popup(BrowserWindow.fromWebContents(event.sender))
})
ipcMain.on('context:find', (event, thisMod) => {
	const menu = Menu.buildFromTemplate(funcLib.menu.page_find(thisMod))
	menu.popup(BrowserWindow.fromWebContents(event.sender))
})
ipcMain.on('main:dragOut', (event, modID) => {
	const thisMod     = serveIPC.modCollect.modColUUIDToRecord(modID)
	const thisFolder  = serveIPC.modCollect.modColUUIDToFolder(modID)

	event.sender.startDrag({
		file : path.join(thisFolder, path.basename(thisMod.fileDetail.fullPath)),
		icon : serveIPC.windowLib.contextIcons.dragDrop,
	})
})
ipcMain.on('context:mod', async (event, modID, modIDs) => {
	const thisCollect = modID.split('--')[0]
	const thisMod     = serveIPC.modCollect.modColUUIDToRecord(modID)
	const thisSite    = serveIPC.storeSites.get(thisMod.fileDetail.shortName, '')
	const thisPath    = serveIPC.modCollect.mapDashedToFullPath(modID)
	const isSave      = thisMod.badgeArray.includes('savegame')
	const notMod      = thisMod.badgeArray.includes('notmod')
	const isLog       = thisMod.badgeArray.includes('log')

	const template = [
		funcLib.menu.icon(thisMod.fileDetail.shortName, null, 'mod', { enabled : false }),
		funcLib.menu.sep,
	]

	if ( !isSave && !notMod && !isLog ) {
		template.push(funcLib.menu.iconL10n(
			'context_mod_detail',
			() => { openDetailWindow(modID) },
			'modDetail'
		))
	} else if ( isLog ) {
		template.push(funcLib.menu.iconL10n(
			'button_gamelog__title',
			() => {
				funcLib.gameSet.setGameLog(thisPath)
				serveIPC.windowLib.createNamedWindow('gamelog')
			},
			'log'
		))
	} else if ( isSave ) {
		const currentGameVersion = funcLib.prefs.ver()
		const subMenu = [...serveIPC.modCollect.collections]
			.filter((x) => serveIPC.modCollect.versionSame(x, currentGameVersion))
			.map(   (collectKey) => ({
				label : serveIPC.modCollect.mapCollectionToName(collectKey),
				click : () => {
					serveIPC.windowLib.createNamedWindow('save', { collectKey : collectKey })
					setTimeout(() => { saveCompare_read(thisPath, thisMod.fileDetail.isFolder) }, 500)
				},
				icon  : serveIPC.windowLib.contextIcons.collection,
			}))

		template.push(funcLib.menu.iconL10n('check_save_text', null, 'save', { submenu : subMenu }))
	}

	template.push(
		funcLib.menu.sep,
		funcLib.menu.iconL10n(
			'open_folder',
			() => { shell.showItemInFolder(thisPath) },
			'openExplorer'
		)
	)

	if ( thisPath.endsWith('.zip') ) {
		template.push(
			funcLib.menu.iconL10n(
				'open_zip',
				() => { shell.openPath(thisPath) },
				'openZip'
			)
		)
	}
	
	if ( thisMod.modHub.id !== null ) {
		template.push(funcLib.menu.iconL10n(
			'open_hub',
			() => { shell.openExternal(funcLib.general.doModHub(thisMod.modHub.id)) },
			'externalSite'
		))
	}

	const didDepend = Array.isArray(thisMod.modDesc.depend) && thisMod.modDesc.depend.length !== 0
	if ( didDepend ) {
		template.push(
			funcLib.menu.sep,
			{
				icon    : serveIPC.windowLib.contextIcons.depend,
				label   : __('menu_depend_on'),
				submenu : thisMod.modDesc.depend.map((x) => funcLib.menu.doDepReq(x, thisCollect)),
			}
		)
	}

	const requireBy = serveIPC.modCollect.getModCollectionFromDashed(modID).requireBy
	if ( Object.hasOwn(requireBy, thisMod.fileDetail.shortName) ) {
		if ( ! didDepend ) { template.push(funcLib.menu.sep) }

		template.push(
			{
				icon    : serveIPC.windowLib.contextIcons.required,
				label   : __('menu_require_by'),
				submenu : requireBy[thisMod.fileDetail.shortName].map((x) => funcLib.menu.doDepReq(x, thisCollect)),
			}
		)
	}

	template.push(
		funcLib.menu.sep,
		funcLib.menu.iconL10n(
			'context_set_website',
			() => { serveIPC.windowLib.sendToWindow('main', 'mods:site', thisMod) },
			'externalSiteSet'
		)
	)

	if ( thisSite !== '' ) {
		template.push(funcLib.menu.iconL10n(
			'context_open_website',
			() => { shell.openExternal(thisSite) },
			'externalSite'
		))
	}

	template.push(
		funcLib.menu.sep,
		funcLib.menu.iconL10n('copy_to_list', () => { sendCopyMoveDelete('copy', [modID]) }, 'fileCopy'),
		funcLib.menu.iconL10n('move_to_list', () => { sendCopyMoveDelete('move', [modID]) }, 'fileMove'),
		funcLib.menu.iconL10n('remove_from_list', () => { sendCopyMoveDelete('delete', [modID]) }, 'fileDelete')
	)

	if ( modIDs.length !== 0 ) {
		template.push(
			funcLib.menu.sep,
			funcLib.menu.iconL10n(
				'copy_selected_to_list',
				() => { sendCopyMoveDelete('copy', modIDs) },
				'fileCopy'
			),
			funcLib.menu.iconL10n(
				'move_selected_to_list',
				() => { sendCopyMoveDelete('move', modIDs) },
				'fileMove'
			),
			funcLib.menu.iconL10n(
				'remove_selected_from_list',
				() => { sendCopyMoveDelete('delete', modIDs) },
				'fileDelete'
			)
		)
	}

	const menu = Menu.buildFromTemplate(template)
	menu.popup(BrowserWindow.fromWebContents(event.sender))
})
ipcMain.on('context:collection', async (event, collection) => {
	const template  = funcLib.menu.page_main_col(collection)

	const noteMenu = ['username', 'password', 'game_admin', 'website', 'admin', 'server']
		.map(   (x) => [x, serveIPC.storeNote.get(`${collection}.notes_${x}`, null)])
		.filter((x) => x[1] !== null )
		.map(   (x) => (funcLib.menu.icon(
			`${__('context_main_copy')} : ${__(`notes_title_${x[0]}`)}`,
			() => { clipboard.writeText(x[1], 'selection') },
			'copy'
		)))

	if ( noteMenu.length !== 0 ) {
		template.push(funcLib.menu.sep, ...noteMenu)
	}
	
	const menu = Menu.buildFromTemplate(template)
	menu.popup(BrowserWindow.fromWebContents(event.sender))
})
// #endregion


// MARK: game log
ipcMain.handle('gamelog:auto', () => {
	funcLib.gameSet.setGameLog(false)
	return funcLib.gameSet.streamGameLog()
})
ipcMain.handle('gamelog:open', () => {
	return dialog.showOpenDialog(serveIPC.windowLib.win.gamelog, {
		properties  : ['openFile'],
		defaultPath : path.join(funcLib.prefs.basePath(), 'log.txt'),
		filters     : [{ name : 'Log Files', extensions : ['txt'] }],
	}).then((result) => {
		if ( ! result.canceled ) { funcLib.gameSet.setGameLog(result.filePaths[0]) }

		return funcLib.gameSet.streamGameLog()
	}).catch((err) => {
		serveIPC.log.danger('file-folder-chooser', 'Could not read specified file', err)
	})
})
ipcMain.handle('gamelog:get',     () => funcLib.gameSet.streamGameLog())
ipcMain.handle('gamelog:getFile', () => funcLib.prefs.gameLogFile())
ipcMain.on('gamelog:folder',   () => shell.showItemInFolder(funcLib.prefs.gameLogFile()) )
ipcMain.on('dispatch:gamelog', () => { serveIPC.windowLib.createNamedWindow('gamelog') })
ipcMain.on('dispatch:history', () => { serveIPC.windowLib.createNamedWindow('history') })
ipcMain.on('dispatch:vault', () => { serveIPC.windowLib.createNamedWindow('vault') })


// MARK : mini window
ipcMain.on('mini:togglePin', () => { serveIPC.windowLib.toggleAlwaysOnTop('mini'); refreshClientModList() })
ipcMain.on('dispatch:mini',  () => { toggleMiniWindow() })
function toggleMiniWindow () {
	if ( serveIPC.windowLib.isValid('mini') && serveIPC.windowLib.isVisible('mini') ) {
		serveIPC.windowLib.safeClose('mini')
	} else {
		serveIPC.windowLib.createNamedWindow('mini')
		serveIPC.windowLib.toggleAlwaysOnTop('mini', true)
	}
}

// MARK: settings IPC
ipcMain.handle('settings:dev',      () => serveIPC.devControls )
ipcMain.handle('settings:get',      (_, key) => {
	return serveIPC.storeSet.get(key)
})
ipcMain.handle('settings:set',      (_, key, value) => {
	funcLib.prefs.setNamed(key, value)
	return serveIPC.storeSet.get(key)
})
ipcMain.handle('settings:themeList', () => [
	['system', __('theme_name_system')],
	['light',  __('theme_name_light')],
	['dark',   __('theme_name_dark')],
])
ipcMain.handle('settings:verList',  ()       => funcLib.gameSet.verList() )
ipcMain.handle('settings:theme',    ()       => serveIPC.windowLib.themeCurrentColor )
ipcMain.handle('settings:units',    ()       => serveIPC.l10n.currentUnits )
ipcMain.handle('settings:lastGame', ()       => serveIPC.gameSetOverride.xml)
ipcMain.handle('settings:activeCollection', () => serveIPC.gameSetOverride.index )

ipcMain.on('settings:themeChange',  (_, theme) => { serveIPC.windowLib.changeTheme(theme) })
ipcMain.on('settings:resetWindows', () => { serveIPC.windowLib.resetPositions() })
ipcMain.on('settings:clearCache',   () => {
	serveIPC.storeCache.clearAll()
	serveIPC.windowLib.forceFocus('main')
	processModFolders(true)
})
ipcMain.on('settings:clearMalware', () => {
	serveIPC.storeSet.set('suppress_malware', [])
	processModFolders(true)
})
ipcMain.on('cache:clear', () => {
	serveIPC.storeCache.clearAll()
	serveIPC.windowLib.forceFocus('main')
	processModFolders(true)
})
ipcMain.on('cache:malware', () => {
	serveIPC.storeSet.set('suppress_malware', [])
	processModFolders(true)
})
ipcMain.on('cache:clean', () => {
	const md5Set     = new Set(serveIPC.storeCache.keys)
	
	for ( const collectKey of serveIPC.modCollect.collections ) {
		for ( const thisSum of Array.from(Object.values(serveIPC.modCollect.getModListFromCollection(collectKey)), (mod) => mod.md5Sum).filter((x) => x !== null) ) {
			md5Set.delete(thisSum)
		}
	}

	serveIPC.log.info('cache-cleaner', `Removed ${md5Set.size} stale entries.`)

	for ( const md5 of md5Set ) { delete serveIPC.storeCache.remMod(md5) }

	serveIPC.storeCache.saveFile()

	setTimeout(() => {
		serveIPC.windowLib.sendToValidWindow('main', 'settings:invalidate')
	}, 500)
})
ipcMain.on('settings:prefFile',    (_, version) => { funcLib.prefs.changeFilePath(version, false) })
ipcMain.on('settings:gamePath',    (_, version) => { funcLib.prefs.changeFilePath(version, true) })
ipcMain.handle('settings:clear',   (_, version) => funcLib.prefs.clearVersion(version))

// MARK: setup wizard
ipcMain.handle('wizard:update', () => ({
	folders : [...serveIPC.modFolders],
	wizard  : funcLib.wizard.getSettings(),
}))
ipcMain.on('dispatch:wizard', () => { openWizard() })
function openWizard() {
	serveIPC.windowLib.createNamedWindow('setup')
}


// MARK: notes & sites
ipcMain.on('dispatch:notes', (_, key) => { serveIPC.windowLib.createNamedWindow('notes', { collectKey : key }) })
ipcMain.handle('settings:collection:get',   (_, collectKey) => serveIPC.modCollect.renderCollectNotes(collectKey) )
ipcMain.handle('settings:collection:set',   (_, collectKey, key, value) => {
	const cleanValue = ( key === 'notes_version' ) ? parseInt(value) : value

	funcLib.prefs.setOrDelete(serveIPC.storeNote, `${collectKey}.${key}`, cleanValue)
	return serveIPC.modCollect.renderCollectNotes(collectKey)
})

ipcMain.handle('settings:site', (_, mod, site = false) => {
	if ( site !== false ) {
		if ( site === '' || site === null ) {
			serveIPC.storeSites.delete(mod)
		} else {
			serveIPC.storeSites.set(mod, site)
		}
		refreshClientModList()
	}
	return serveIPC.storeSites.get(mod, '')
})

ipcMain.handle('settings:site:githubLatest', async (_, sourceURL) => getGitHubLatestUpdate(sourceURL))

async function getGitHubLatestUpdate(sourceURL) {
	const repoInfo = getGitHubRepoInfo(sourceURL)
	if ( repoInfo === null ) {
		return { ok : false, error : 'invalid_github_url' }
	}

	const headers = {
		Accept        : 'application/vnd.github+json',
		'User-Agent' : 'FS-Mod-Assistant',
	}

	try {
		const resolvedRepo = await getGitHubResolvedRepo(repoInfo, headers)
		const releaseResult = await getGitHubReleaseResult(resolvedRepo, headers)
		if ( releaseResult !== null ) { return releaseResult }

		const stableReleaseResult = await getGitHubStableReleaseResult(resolvedRepo)
		if ( stableReleaseResult !== null ) { return stableReleaseResult }

		return { ok : false, error : 'no_release_or_tag', url : resolvedRepo.htmlURL }
	} catch (err) {
		return { ok : false, error : err.message, url : repoInfo.htmlURL }
	}
}

async function getGitHubReleaseResult(resolvedRepo, headers) {
	const releaseURL      = `https://api.github.com/repos/${resolvedRepo.owner}/${resolvedRepo.repo}/releases/latest`
	const releaseResponse = await fetch(releaseURL, { headers })
	if ( !releaseResponse.ok ) { return null }

	const release  = await releaseResponse.json()
	const zipAsset = getGitHubReleaseZipAsset(release) ?? await getGitHubRepoZipAsset(resolvedRepo, headers)
	return {
		assetName      : zipAsset?.name ?? null,
		downloadSource : zipAsset?.downloadSource ?? null,
		downloadURL    : zipAsset?.browser_download_url ?? zipAsset?.download_url ?? null,
		hasDownload    : zipAsset !== null,
		ok             : true,
		source         : 'release',
		url            : release.html_url || resolvedRepo.htmlURL,
		version        : release.tag_name || release.name || '',
	}
}

async function getGitHubStableReleaseResult(resolvedRepo) {
	const releaseURL       = await getGitHubStableReleaseURL(resolvedRepo)
	const releaseMatch     = releaseURL.match(/\/releases\/tag\/([^#/?]+)/)
	if ( releaseMatch === null ) { return null }

	const stableTag = decodeURIComponent(releaseMatch[1])
	if ( isGitHubPrereleaseTag(stableTag) ) { return null }

	const releaseRepo = getGitHubRepoInfo(releaseURL) ?? resolvedRepo
	const zipAsset = await getGitHubStableReleaseNamedZipAsset(releaseRepo, stableTag)
	if ( zipAsset === null ) { return null }

	return {
		assetName      : zipAsset?.name ?? null,
		downloadSource : zipAsset?.downloadSource ?? null,
		downloadURL    : zipAsset.download_url,
		hasDownload    : zipAsset !== null,
		ok             : true,
		source         : 'release',
		url            : `${releaseRepo.htmlURL}/releases/tag/${stableTag}`,
		version        : stableTag,
	}
}

async function getGitHubStableReleaseURL(resolvedRepo) {
	return getGitHubStableReleaseRedirectURL(`${resolvedRepo.htmlURL}/releases/latest`, 0)
}

async function getGitHubStableReleaseRedirectURL(latestReleaseURL, redirectCount) {
	if ( redirectCount >= 5 ) { return latestReleaseURL }

	const releaseResponse = await fetch(latestReleaseURL, { method : 'HEAD', redirect : 'manual' })
	const redirectURL = releaseResponse.headers.get('location')

	if ( redirectURL === null ) { return releaseResponse.url }

	const nextURL = new URL(redirectURL, latestReleaseURL).toString()
	if ( nextURL.includes('/releases/tag/') ) { return nextURL }
	return getGitHubStableReleaseRedirectURL(nextURL, redirectCount + 1)
}

function getGitHubReleaseZipAsset(release) {
	if ( !Array.isArray(release.assets) ) { return null }
	const zipAsset = release.assets.find((asset) => {
		if ( typeof asset?.name !== 'string' ) { return false }
		if ( typeof asset?.browser_download_url !== 'string' ) { return false }
		return asset.name.toLowerCase().endsWith('.zip')
	}) ?? null
	if ( zipAsset !== null ) { zipAsset.downloadSource = 'releaseAsset' }
	return zipAsset
}

async function getGitHubRepoZipAsset(repoInfo, headers) {
	const contentsURL      = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents?ref=${repoInfo.defaultBranch}`
	const contentsResponse = await fetch(contentsURL, { headers })
	if ( !contentsResponse.ok ) { return getGitHubRepoNamedZipAsset(repoInfo) }

	const contents = await contentsResponse.json()
	if ( !Array.isArray(contents) ) { return getGitHubRepoNamedZipAsset(repoInfo) }

	const zipFiles = contents.filter((item) => {
		if ( item?.type !== 'file' ) { return false }
		if ( typeof item?.name !== 'string' ) { return false }
		if ( typeof item?.download_url !== 'string' ) { return false }
		return item.name.toLowerCase().endsWith('.zip')
	})

	if ( zipFiles.length === 0 ) { return getGitHubRepoNamedZipAsset(repoInfo) }

	const repoName = repoInfo.repo.toLowerCase()
	const zipAsset = zipFiles.find((item) => {
		const itemName = item.name.toLowerCase()
		return itemName === `${repoName}.zip` || itemName.includes(repoName)
	}) ?? zipFiles[0]

	return {
		downloadSource : 'repositoryFile',
		download_url   : zipAsset.download_url,
		name           : zipAsset.name,
	}
}

async function getGitHubRepoNamedZipAsset(repoInfo) {
	const fileName = `${repoInfo.repo}.zip`
	const branches = [...new Set([repoInfo.defaultBranch, 'main', 'master'].filter((branch) => typeof branch === 'string' && branch !== ''))]

	const candidates = await Promise.all(branches.map(async (branch) => {
		const downloadURL = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${branch}/${fileName}`
		try {
			const response = await fetch(downloadURL, { method : 'HEAD' })
			if ( response.ok ) {
				return {
					downloadSource : 'repositoryFile',
					download_url   : downloadURL,
					name           : fileName,
				}
			}
		} catch {
			return null
		}
		return null
	}))

	return candidates.find((candidate) => candidate !== null) ?? null
}

async function getGitHubStableReleaseNamedZipAsset(repoInfo, stableTag) {
	const fileName = `${repoInfo.repo}.zip`
	const downloadURL = `${repoInfo.htmlURL}/releases/download/${stableTag}/${fileName}`
	try {
		const response = await fetch(downloadURL, { method : 'HEAD' })
		if ( response.ok ) {
			return {
				downloadSource : 'releaseAsset',
				download_url   : downloadURL,
				name           : fileName,
			}
		}
	} catch {
		return null
	}
	return null
}

function isGitHubPrereleaseTag(tagName) {
	return /(?:^|[.-])(?:alpha|beta|dev|preview|pre|rc)(?:[.-]|\d|$)/i.test(tagName)
}

function uniqueCleanArray(values) {
	return [...new Set(values.filter((value) => typeof value === 'string' && value !== ''))]
}

async function sha256File(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256')
		const stream = fs.createReadStream(filePath)
		stream.on('error', reject)
		stream.on('data', (chunk) => { hash.update(chunk) })
		stream.on('end', () => { resolve(hash.digest('hex')) })
	})
}

function modLibraryFilePath(hash, fileName) {
	const ext = path.extname(safeDownloadFileName(fileName)) || '.zip'
	return path.join(app.getPath('userData'), 'mod-library', 'files', hash.slice(0, 2), `${hash}${ext}`)
}

async function registerModLibraryFile(filePath, metadata = {}) {
	if ( typeof filePath !== 'string' || !fs.existsSync(filePath) ) {
		throw new Error('Library source file was not found')
	}

	const hash = await sha256File(filePath)
	const fileName = safeDownloadFileName(metadata.fileName ?? path.basename(filePath))
	const libraryPath = modLibraryFilePath(hash, fileName)
	const fileStat = await fsPromise.stat(filePath)

	await fsPromise.mkdir(path.dirname(libraryPath), { recursive : true })
	if ( !fs.existsSync(libraryPath) ) {
		await fsPromise.copyFile(filePath, libraryPath)
	}

	const records = serveIPC.storeLibrary.get('records', {})
	const existingRecord = records[hash] ?? {
		collections : [],
		createdAt   : new Date().toISOString(),
		fileName    : fileName,
		filePath    : libraryPath,
		hash        : hash,
		modNames    : [],
		size        : fileStat.size,
		sources     : [],
		versions    : [],
	}

	records[hash] = {
		...existingRecord,
		collections : uniqueCleanArray([...(existingRecord.collections ?? []), metadata.collectionName]),
		fileName    : existingRecord.fileName ?? fileName,
		filePath    : libraryPath,
		modNames    : uniqueCleanArray([...(existingRecord.modNames ?? []), metadata.modName]),
		size        : fileStat.size,
		sources     : uniqueCleanArray([...(existingRecord.sources ?? []), metadata.source]),
		sourceURL   : metadata.sourceURL ?? existingRecord.sourceURL ?? null,
		updatedAt   : new Date().toISOString(),
		versions    : uniqueCleanArray([...(existingRecord.versions ?? []), metadata.version]),
	}

	serveIPC.storeLibrary.set('records', records)

	return {
		fileName,
		hash,
		libraryPath,
		size : fileStat.size,
	}
}

function findCachedModLibraryFile(metadata = {}) {
	if ( typeof metadata.modName !== 'string' || typeof metadata.version !== 'string' ) { return null }

	const records = serveIPC.storeLibrary.get('records', {})
	return Object.values(records).find((record) => {
		if ( typeof record?.filePath !== 'string' || !fs.existsSync(record.filePath) ) { return false }
		if ( !Array.isArray(record.modNames) || !record.modNames.includes(metadata.modName) ) { return false }
		if ( !Array.isArray(record.versions) || !record.versions.includes(metadata.version) ) { return false }
		if ( typeof metadata.sourceURL === 'string' && metadata.sourceURL !== '' && typeof record.sourceURL === 'string' ) {
			return record.sourceURL === metadata.sourceURL
		}
		return true
	}) ?? null
}

function getModLibrarySummary() {
	const records = serveIPC.storeLibrary.get('records', {})
	const historyEntries = serveIPC.storeHistory.get('entries', [])
	const usedHashes = new Set(historyEntries.flatMap((entry) => [entry.backupHash, entry.currentHash]).filter((value) => typeof value === 'string'))
	const usedPaths = new Set(historyEntries.flatMap((entry) => [entry.backupPath, entry.currentLibraryPath]).filter((value) => typeof value === 'string'))
	const entries = Object.values(records)
		.map((record) => {
			const fileExists = typeof record?.filePath === 'string' && fs.existsSync(record.filePath)
			const size = fileExists ? fs.statSync(record.filePath).size : (record.size ?? 0)
			return {
				collections  : Array.isArray(record.collections) ? record.collections : [],
				createdAt    : record.createdAt ?? null,
				fileExists   : fileExists,
				fileName     : record.fileName ?? path.basename(record.filePath ?? ''),
				filePath     : record.filePath ?? null,
				hash         : record.hash ?? null,
				isUsed       : usedHashes.has(record.hash) || usedPaths.has(record.filePath),
				modNames     : Array.isArray(record.modNames) ? record.modNames : [],
				size         : size,
				sources      : Array.isArray(record.sources) ? record.sources : [],
				sourceURL    : record.sourceURL ?? null,
				updatedAt    : record.updatedAt ?? null,
				versions     : Array.isArray(record.versions) ? record.versions : [],
			}
		})
		.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

	return {
		entries,
		folder     : path.join(app.getPath('userData'), 'mod-library'),
		totalCount : entries.length,
		totalSize  : entries.reduce((sum, entry) => sum + entry.size, 0),
		usedCount  : entries.filter((entry) => entry.isUsed).length,
	}
}

async function backupModToLibrary(filePath, metadata = {}) {
	if ( !fs.existsSync(filePath) ) {
		return {
			backupHash : null,
			backupPath : null,
			didBackup  : false,
		}
	}

	const libraryRecord = await registerModLibraryFile(filePath, {
		collectionName : metadata.collectionName,
		fileName       : metadata.fileName ?? path.basename(filePath),
		modName        : metadata.modName,
		source         : metadata.source ?? 'Collection',
		sourceURL      : metadata.sourceURL ?? null,
		version        : metadata.version,
	})

	return {
		backupHash : libraryRecord.hash,
		backupPath : libraryRecord.libraryPath,
		didBackup  : true,
	}
}

async function downloadGitHubZipToPath(download, filePath) {
	if ( typeof download?.url !== 'string' || typeof download?.fileName !== 'string' ) {
		throw new Error('Invalid download candidate')
	}

	const url = new URL(download.url)
	if ( url.protocol !== 'https:' ) { throw new Error('Only HTTPS downloads are allowed') }
	if ( !download.fileName.toLowerCase().endsWith('.zip') ) { throw new Error('Only ZIP downloads are allowed') }

	await fsPromise.mkdir(path.dirname(filePath), { recursive : true })
	const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${Date.now()}.download`)

	try {
		await new Promise((resolve, reject) => {
			const request = net.request(download.url)
			request.on('response', (response) => {
				if ( response.statusCode < 200 || response.statusCode >= 400 ) {
					reject(new Error(`Download failed with status ${response.statusCode}`))
					return
				}

				const writeStream = fs.createWriteStream(tempPath)
				response.pipe(writeStream)
				response.on('error', reject)
				writeStream.on('error', reject)
				writeStream.on('finish', () => {
					writeStream.close(resolve)
				})
			})
			request.on('error', reject)
			request.end()
		})

		await fsPromise.rm(filePath, { force : true })
		await fsPromise.rename(tempPath, filePath)
		return filePath
	} catch (err) {
		await fsPromise.rm(tempPath, { force : true }).catch(() => {})
		throw err
	}
}

function getCollectionModRecord(collectionKey, modName) {
	const collection = serveIPC.modCollect.allModList?.[collectionKey]
	if ( typeof collection?.mods !== 'object' ) { return null }
	return Object.values(collection.mods).find((mod) => mod?.fileDetail?.shortName === modName) ?? null
}

async function downloadAndApplyUpdate(download) {
	if (
		typeof download?.collectionKey !== 'string' ||
		typeof download?.fileName !== 'string' ||
		typeof download?.modName !== 'string' ||
		typeof download?.url !== 'string'
	) {
		throw new Error('Invalid update candidate')
	}

	const modRecord = getCollectionModRecord(download.collectionKey, download.modName)
	if ( modRecord === null ) { throw new Error(`Mod not found in collection: ${download.modName}`) }
	if ( modRecord.fileDetail.isFolder ) { throw new Error(`Folder mods cannot be replaced yet: ${download.modName}`) }

	const collectionName = serveIPC.modCollect.mapCollectionToName(download.collectionKey) ?? download.collectionName ?? download.collectionKey
	const collectionFolder = serveIPC.modCollect.mapCollectionToFolder(download.collectionKey)
	const targetPath = path.join(collectionFolder, path.basename(modRecord.fileDetail.fullPath))
	const tempFolder = path.join(app.getPath('temp'), 'fsg-mod-assistant-update-downloads', safeDownloadFolderName(collectionName))
	const tempPath = path.join(tempFolder, `${Date.now()}-${safeDownloadFileName(download.fileName)}`)

	try {
		const cachedLibrary = findCachedModLibraryFile({
			modName   : download.modName,
			sourceURL : download.sourceURL ?? null,
			version   : download.version,
		})
		const downloadLibrary = cachedLibrary === null ?
			await downloadGitHubZipToPath(download, tempPath).then(() => registerModLibraryFile(tempPath, {
				collectionName,
				fileName  : download.fileName,
				modName   : download.modName,
				source    : 'GitHub',
				sourceURL : download.sourceURL ?? null,
				version   : download.version,
			})) :
			cachedLibrary
		const backupResult = await backupModToLibrary(targetPath, {
			collectionName,
			fileName  : path.basename(targetPath),
			modName   : download.modName,
			source    : 'Collection',
			sourceURL : download.sourceURL ?? null,
			version   : modRecord.modDesc.version,
		})
		await fsPromise.copyFile(downloadLibrary.libraryPath ?? downloadLibrary.filePath, targetPath)

		return {
			backupHash : backupResult.backupHash,
			backupPath : backupResult.backupPath,
			collectionName,
			currentHash : downloadLibrary.hash,
			currentLibraryPath : downloadLibrary.libraryPath ?? downloadLibrary.filePath,
			previousVersion : modRecord.modDesc.version,
			targetPath,
			tempPath,
			usedCache : cachedLibrary !== null,
		}
	} finally {
		await fsPromise.rm(tempPath, { force : true }).catch(() => {})
	}
}

function hasRollbackBackup(update) {
	return getLatestRollbackEntry(update) !== null
}

function getLatestRollbackEntry(update) {
	if ( typeof update?.collectionKey !== 'string' || typeof update?.modName !== 'string' ) { return null }

	const collectionName = typeof update.collectionName === 'string' ?
		update.collectionName :
		serveIPC.modCollect.mapCollectionToName(update.collectionKey)
	const historyEntries = serveIPC.storeHistory.get('entries', [])

	return historyEntries.find((entry) => {
		if ( entry?.action !== 'update_applied' ) { return false }
		if ( entry?.collectionName !== collectionName ) { return false }
		if ( entry?.modName !== update.modName ) { return false }
		if ( typeof entry?.backupPath !== 'string' ) { return false }
		return fs.existsSync(entry.backupPath)
	}) ?? null
}

function getRollbackEntries(update) {
	if ( typeof update?.collectionKey !== 'string' || typeof update?.modName !== 'string' ) { return [] }

	const collectionName = typeof update.collectionName === 'string' ?
		update.collectionName :
		serveIPC.modCollect.mapCollectionToName(update.collectionKey)
	const historyEntries = serveIPC.storeHistory.get('entries', [])
	const seenBackups = new Set()

	const rollbackEntries = historyEntries
		.filter((entry) => {
			if ( entry?.action !== 'update_applied' ) { return false }
			if ( entry?.collectionName !== collectionName ) { return false }
			if ( entry?.modName !== update.modName ) { return false }
			if ( typeof entry?.backupPath !== 'string' ) { return false }
			if ( !fs.existsSync(entry.backupPath) ) { return false }
			const backupKey = entry.backupHash ?? entry.backupPath
			if ( seenBackups.has(backupKey) ) { return false }
			seenBackups.add(backupKey)
			return true
		})
		.map((entry) => ({
			action           : entry.action ?? 'unknown',
			backupHash       : entry.backupHash ?? null,
			backupPath       : entry.backupPath,
			collectionName   : entry.collectionName ?? collectionName,
			currentVersion   : entry.currentVersion ?? null,
			fileName         : entry.fileName ?? update.fileName ?? null,
			modName          : entry.modName ?? update.modName,
			previousVersion  : entry.previousVersion ?? null,
			source           : entry.source ?? null,
			sourceURL        : entry.sourceURL ?? null,
			targetPath       : entry.targetPath ?? null,
			timestamp        : entry.timestamp ?? null,
		}))

	return rollbackEntries.some((entry) => entry.previousVersion !== null || entry.currentVersion !== null) ?
		rollbackEntries.filter((entry) => entry.previousVersion !== null || entry.currentVersion !== null) :
		rollbackEntries
}

async function rollbackLatestUpdate(update) {
	const rollbackEntry = getLatestRollbackEntry(update)
	if ( rollbackEntry === null ) { throw new Error(`No rollback backup found for: ${update?.modName ?? 'unknown mod'}`) }
	if ( typeof rollbackEntry.targetPath !== 'string' ) { throw new Error(`Rollback target is missing for: ${update.modName}`) }
	if ( !fs.existsSync(rollbackEntry.targetPath) ) { throw new Error(`Current mod ZIP not found: ${path.basename(rollbackEntry.targetPath)}`) }

	const currentBackup = await backupModToLibrary(rollbackEntry.targetPath, {
		collectionName : rollbackEntry.collectionName,
		fileName       : path.basename(rollbackEntry.targetPath),
		modName        : rollbackEntry.modName,
		source         : 'Rollback current',
		sourceURL      : rollbackEntry.sourceURL ?? null,
		version        : rollbackEntry.currentVersion ?? null,
	})
	await fsPromise.copyFile(rollbackEntry.backupPath, rollbackEntry.targetPath)

	return {
		backupHash     : currentBackup.backupHash,
		backupPath     : currentBackup.backupPath,
		collectionName : rollbackEntry.collectionName,
		rollbackHash   : rollbackEntry.backupHash ?? null,
		rollbackPath   : rollbackEntry.backupPath,
		targetPath     : rollbackEntry.targetPath,
	}
}

async function rollbackHistoryEntry(entry) {
	if ( typeof entry?.backupPath !== 'string' || !fs.existsSync(entry.backupPath) ) {
		throw new Error('Rollback backup file was not found')
	}
	if ( typeof entry?.targetPath !== 'string' || !fs.existsSync(entry.targetPath) ) {
		throw new Error('Current mod ZIP was not found')
	}

	const collectionName = entry.collectionName ?? 'updates'
	const currentBackup = await backupModToLibrary(entry.targetPath, {
		collectionName,
		fileName  : path.basename(entry.targetPath),
		modName   : entry.modName ?? path.basename(entry.targetPath, '.zip'),
		source    : 'Rollback current',
		sourceURL : entry.sourceURL ?? null,
		version   : entry.currentVersion ?? null,
	})
	await fsPromise.copyFile(entry.backupPath, entry.targetPath)

	return {
		backupHash     : currentBackup.backupHash,
		backupPath     : currentBackup.backupPath,
		collectionName : collectionName,
		fileName       : entry.fileName ?? path.basename(entry.targetPath),
		modName        : entry.modName ?? path.basename(entry.targetPath, '.zip'),
		rollbackHash   : entry.backupHash ?? null,
		rollbackPath   : entry.backupPath,
		sourceURL      : entry.sourceURL ?? null,
		targetPath     : entry.targetPath,
	}
}

function processModFoldersAndWait() {
	return new Promise((resolve) => {
		modQueueRunner.once('process-mods-done', () => { resolve() })
		processModFolders(true)
	})
}

function addCollectionHistoryEntry(entry) {
	const historyEntries = serveIPC.storeHistory.get('entries', [])
	const cleanEntry = {
		action           : entry.action ?? 'unknown',
		backupHash       : entry.backupHash ?? null,
		backupPath       : entry.backupPath ?? null,
		collectionName   : entry.collectionName ?? null,
		currentHash      : entry.currentHash ?? null,
		currentLibraryPath : entry.currentLibraryPath ?? null,
		currentVersion   : entry.currentVersion ?? null,
		fileName         : entry.fileName ?? null,
		modName          : entry.modName ?? null,
		previousVersion  : entry.previousVersion ?? null,
		replacedExisting : entry.replacedExisting ?? false,
		rollbackHash     : entry.rollbackHash ?? null,
		source           : entry.source ?? null,
		sourceURL        : entry.sourceURL ?? null,
		stagedPath       : entry.stagedPath ?? null,
		targetPath       : entry.targetPath ?? null,
		timestamp        : new Date().toISOString(),
	}

	historyEntries.unshift(cleanEntry)
	serveIPC.storeHistory.set('entries', historyEntries.slice(0, 1000))
}

function safeDownloadFileName(fileName) {
	const safeName = path.basename(fileName).replace(/["*/:<>?\\|]/g, '_')
	if ( safeName === '' || safeName === '.' || safeName === '..' ) { return 'github-update.zip' }
	return safeName
}

function safeDownloadFolderName(folderName) {
	if ( typeof folderName !== 'string' ) { return 'updates' }
	const safeName = folderName.replace(/["*/:<>?\\|]/g, '_').trim()
	if ( safeName === '' || safeName === '.' || safeName === '..' ) { return 'updates' }
	return safeName
}

async function getGitHubResolvedRepo(repoInfo, headers) {
	const repoURL      = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`
	const repoResponse = await fetch(repoURL, { headers })
	if ( repoResponse.ok ) {
		const repo = await repoResponse.json()
		const [owner, repoName] = repo.full_name.split('/')
		return {
			defaultBranch : repo.default_branch || 'main',
			htmlURL       : repo.html_url || `https://github.com/${owner}/${repoName}`,
			owner         : owner,
			repo          : repoName,
		}
	}

	return {
		defaultBranch : 'main',
		...repoInfo,
	}
}

function getGitHubRepoInfo(sourceURL) {
	try {
		const url = new URL(sourceURL)
		if ( url.protocol !== 'https:' ) { return null }
		if ( url.hostname.toLowerCase() !== 'github.com' ) { return null }

		const parts = url.pathname.split('/').filter((item) => item !== '')
		if ( parts.length < 2 ) { return null }

		return {
			htmlURL : `https://github.com/${parts[0]}/${parts[1]}`,
			owner   : parts[0],
			repo    : parts[1],
		}
	} catch {
		return null
	}
}

// MARK: download
ipcMain.on('file:downloadCancel', () => { if ( serveIPC.dlRequest !== null ) { serveIPC.dlRequest.abort() } })
ipcMain.on('file:download',   (_, CKey) => { funcLib.general.importZIP(CKey) })


// MARK: export
ipcMain.on('file:exportCSV', (_, CKey) => { funcLib.general.exportCSV(CKey) })
ipcMain.on('file:exportZIP', (_, mods) => { funcLib.general.exportZIP(mods) })


// MARK: save manage
ipcMain.on('dispatch:savemanage', () => { funcLib.saveManage.refresh() })
ipcMain.on('savemanage:compare', (_, fullPath, collectKey) => {
	serveIPC.windowLib.createNamedWindow('save', { collectKey : collectKey })
	setTimeout(() => { saveCompare_read(fullPath, true) }, 500)
})
ipcMain.on('savemanage:delete',  (_, fullPath) => { funcLib.saveManage.delete(fullPath) })
ipcMain.on('savemanage:export',  (_, fullPath) => { funcLib.saveManage.export(fullPath) })
ipcMain.on('savemanage:restore', (_, fullPath, newSlot) => { funcLib.saveManage.restore(fullPath, newSlot) })
ipcMain.on('savemanage:import',  (_, fullPath, newSlot) => { funcLib.saveManage.doImport(fullPath, newSlot) })
ipcMain.on('savemanage:getImport', () => { funcLib.saveManage.getImport() })


// MARK: save track
ipcMain.on('dispatch:savetrack',   () => { serveIPC.windowLib.createNamedWindow('save_track') })
ipcMain.on('savetrack:folder', () => {
	const options = {
		properties  : ['openDirectory'],
		defaultPath : funcLib.prefs.basePath(),
	}

	dialog.showOpenDialog(serveIPC.windowLib.win.save_track, options).then((result) => {
		if ( !result.canceled ) {
			try {
				new savegameTrack(result.filePaths[0]).getInfo().then((results) => {
					serveIPC.windowLib.sendModList({ saveInfo : results }, 'savetrack:results', 'save_track', false )
				})
			} catch (err) {
				serveIPC.log.danger('save-track', 'Load failed', err)
			}
		}
	}).catch((err) => {
		serveIPC.log.danger('save-track', 'Could not read specified folder', err)
	})
})

// MARK: save compare
ipcMain.on('dispatch:save',       (_, collection) => { serveIPC.windowLib.createNamedWindow('save', { collectKey : collection }) })
ipcMain.on('select:listInMain', (_, selectList) => {
	if ( serveIPC.windowLib.isValid('main') ) {
		serveIPC.windowLib.win.main.focus()
		serveIPC.windowLib.sendToWindow('main', 'select:list', selectList)
	}
})
ipcMain.on('save:folder', () => { saveCompare_open(false) })
ipcMain.on('save:file',    () => { saveCompare_open(true) })
ipcMain.on('save:drop',   (_, type, thisPath) => {
	if ( type !== 'zip' && !fs.statSync(thisPath).isDirectory() ) { return }
	saveCompare_read(thisPath, type !== 'zip')
})
ipcMain.on('save:cacheGameSave', (_, payload) => {
	serveIPC.cacheGameSave = payload
	refreshClientModList()
})

function saveCompare_read(thisPath) {
	try {
		const saveResult = JSON.parse(parseSaveGame(thisPath))
		serveIPC.windowLib.sendModList({ thisSaveGame : saveResult }, 'save:saveInfo', 'save', false )
	} catch (err) {
		serveIPC.log.danger('save-check', 'Load failed', thisPath, err.message)
	}
}
function saveCompare_open(zipMode = false) {
	const options = {
		properties  : [(zipMode) ? 'openFile' : 'openDirectory'],
		defaultPath : funcLib.prefs.basePath(),
		filters      : zipMode ?
			[{ name : 'ZIP Files', extensions : ['zip'] }] :
			null,
	}

	dialog.showOpenDialog(serveIPC.windowLib.win.save, options).then((result) => {
		if ( !result.canceled ) { saveCompare_read(result.filePaths[0], !zipMode) }
	}).catch((err) => {
		serveIPC.log.danger('save-check', 'Could not read specified file/folder', err)
	})
}

// MARK: input bindings
ipcMain.on('dispatch:input',    ()        => { serveIPC.windowLib.createNamedWindow('input') })
ipcMain.handle('input:list',    ()        => funcLib.inputManage.list())
ipcMain.handle('input:load',    (_, s)    => funcLib.inputManage.load(s))
ipcMain.handle('input:delete',  (_, s)    => funcLib.inputManage.delete(s))
ipcMain.handle('input:copy',    (_, s, d) => funcLib.inputManage.copy(s, d))
ipcMain.handle('input:restore', (_, s, v) => funcLib.inputManage.restore(s, v))

// MARK: version resolve
ipcMain.on('dispatch:version', () => { serveIPC.windowLib.createNamedWindow('version') })
ipcMain.on('dispatch:update', () => { serveIPC.windowLib.createNamedWindow('update') })
ipcMain.handle('update:list', () => serveIPC.modCollect.toRenderer({
	activeCollection : serveIPC.gameSetOverride.index,
	modSites         : serveIPC.storeSites.store,
}))
ipcMain.handle('history:all', () => serveIPC.storeHistory.get('entries', []))
ipcMain.handle('history:clear', () => {
	serveIPC.storeHistory.set('entries', [])
	return { ok : true }
})
ipcMain.handle('vault:all', () => getModLibrarySummary())
ipcMain.handle('vault:openFolder', () => shell.openPath(path.join(app.getPath('userData'), 'mod-library')))
ipcMain.handle('history:rollbackEntry', async (_, entry) => {
	try {
		const backupFolder = path.join(app.getPath('userData'), 'update-backups')
		await fsPromise.mkdir(backupFolder, { recursive : true })

		const rollbackResult = await rollbackHistoryEntry(entry)
		addCollectionHistoryEntry({
			action           : 'update_rolled_back',
			backupHash       : rollbackResult.backupHash,
			backupPath       : rollbackResult.backupPath,
			collectionName   : rollbackResult.collectionName,
			fileName         : rollbackResult.fileName,
			modName          : rollbackResult.modName,
			replacedExisting : rollbackResult.backupPath !== null,
			rollbackHash     : rollbackResult.rollbackHash,
			source           : 'Rollback',
			sourceURL        : rollbackResult.sourceURL,
			stagedPath       : rollbackResult.rollbackPath,
			targetPath       : rollbackResult.targetPath,
		})

		funcLib.general.toggleFolderDirty()
		await processModFoldersAndWait()
		return { ok : true }
	} catch (err) {
		return { ok : false, error : err.message }
	}
})
ipcMain.handle('update:hasRollbackBackup', (_, update) => hasRollbackBackup(update))
ipcMain.handle('update:rollbackEntries', (_, update) => getRollbackEntries(update))
ipcMain.handle('update:rollbackEntry', async (_, entry) => {
	try {
		const rollbackResult = await rollbackHistoryEntry(entry)
		addCollectionHistoryEntry({
			action           : 'update_rolled_back',
			backupHash       : rollbackResult.backupHash,
			backupPath       : rollbackResult.backupPath,
			collectionName   : rollbackResult.collectionName,
			fileName         : rollbackResult.fileName,
			modName          : rollbackResult.modName,
			replacedExisting : rollbackResult.backupPath !== null,
			rollbackHash     : rollbackResult.rollbackHash,
			source           : 'Rollback',
			sourceURL        : rollbackResult.sourceURL,
			stagedPath       : rollbackResult.rollbackPath,
			targetPath       : rollbackResult.targetPath,
		})

		funcLib.general.toggleFolderDirty()
		await processModFoldersAndWait()
		return { ok : true }
	} catch (err) {
		return { ok : false, error : err.message }
	}
})
ipcMain.handle('update:rollbackLatest', async (_, update) => {
	try {
		const backupFolder = path.join(app.getPath('userData'), 'update-backups')
		await fsPromise.mkdir(backupFolder, { recursive : true })

		const rollbackResult = await rollbackLatestUpdate(update)
		addCollectionHistoryEntry({
			action           : 'update_rolled_back',
			backupHash       : rollbackResult.backupHash,
			backupPath       : rollbackResult.backupPath,
			collectionName   : rollbackResult.collectionName,
			fileName         : update.fileName ?? null,
			modName          : update.modName,
			replacedExisting : rollbackResult.backupPath !== null,
			rollbackHash     : rollbackResult.rollbackHash,
			source           : 'Rollback',
			sourceURL        : update.sourceURL ?? null,
			stagedPath       : rollbackResult.rollbackPath,
			targetPath       : rollbackResult.targetPath,
		})

		funcLib.general.toggleFolderDirty()
		await processModFoldersAndWait()
		return { ok : true }
	} catch (err) {
		return { ok : false, error : err.message }
	}
})
ipcMain.handle('update:downloadApplySelected', async (_, downloads) => {
	try {
		if ( !Array.isArray(downloads) || downloads.length === 0 ) {
			return { ok : false, error : 'No downloadable updates selected' }
		}

		const backupFolder = path.join(app.getPath('userData'), 'update-backups')
		await fsPromise.mkdir(backupFolder, { recursive : true })

		const updateCount = await downloads.reduce(async (previousCount, download) => {
			const count = await previousCount
			const updateResult = await downloadAndApplyUpdate(download)
			addCollectionHistoryEntry({
				action           : 'update_applied',
				backupHash       : updateResult.backupHash,
				backupPath       : updateResult.backupPath,
				collectionName   : updateResult.collectionName,
				currentHash      : updateResult.currentHash,
				currentLibraryPath : updateResult.currentLibraryPath,
				currentVersion   : download.version ?? null,
				fileName         : download.fileName,
				modName          : download.modName,
				previousVersion  : updateResult.previousVersion ?? null,
				replacedExisting : updateResult.backupPath !== null,
				source           : updateResult.usedCache ? 'GitHub cache' : 'GitHub',
				sourceURL        : download.sourceURL,
				stagedPath       : null,
				targetPath       : updateResult.targetPath,
			})
			return count + 1
		}, Promise.resolve(0))

		funcLib.general.toggleFolderDirty()
		await processModFoldersAndWait()
		return { count : updateCount, ok : true }
	} catch (err) {
		return { ok : false, error : err.message }
	}
})
ipcMain.on('dispatch:resolve', (_, key) => { serveIPC.windowLib.createNamedWindow('resolve', { shortName : key }) })

// MARK: debug log
ipcMain.on('debug:log', (_e, level, process, ...args) => { serveIPC.log[level](process, ...args) })
ipcMain.handle('debug:all', () => serveIPC.log.htmlLog )
ipcMain.on('dispatch:debug', () => {
	serveIPC.isDebugDanger = false
	serveIPC.windowLib.createNamedWindow('debug')
})

// MARK: misc window.
ipcMain.on('dispatch:changelog', () => { serveIPC.windowLib.createNamedWindow('change') } )
ipcMain.on('dispatch:find', () => { serveIPC.windowLib.createNamedWindow('find') } )
ipcMain.on('select:withText', (_, id, txt) => {
	serveIPC.windowLib.sendAndFocusValid('main', 'select:withText', id, txt)
})
ipcMain.on('dispatch:game', ()         => { funcLib.gameLauncher() })
ipcMain.on('dispatch:help', ()         => { shell.openExternal('https://fsgmodding.github.io/FSG_Mod_Assistant/') })
ipcMain.on('win:clipboard', (_, value) => clipboard.writeText(value, 'selection') )
ipcMain.on('win:openURL',   (_, url)   => { shell.openExternal(url) })
ipcMain.on('win:close',     (e)        => { BrowserWindow.fromWebContents(e.sender).close() })

ipcMain.on('main:minimizeToTray',   () => { serveIPC.windowLib.sendToTray() })
ipcMain.on('main:runUpdateInstall', () => {
	if ( serveIPC.modCollect.updateIsReady ) {
		serveIPC.autoUpdater.quitAndInstall()
	} else {
		serveIPC.log.debug('auto-update', 'Auto-Update Called Before Ready.')
	}
})


// MARK: app status flags
ipcMain.handle('state:all', () => { return {
	botStatus          : serveIPC.modCollect.botDetails,
	dangerDebug        : serveIPC.isDebugDanger,
	foldersDirty       : serveIPC.isFoldersDirty,
	gameRunning        : serveIPC.isGameRunning,
	gameRunningEnabled : serveIPC.isGamePolling,
	keepLoaderModal    : serveIPC.isProcessing || serveIPC.isDownloading || serveIPC.isZipExporting,
	pinMini            : serveIPC.windowLib.isAlwaysOnTop('mini'),
	prefDanger         : serveIPC.isPrefWrong,
	updateReady        : serveIPC.modCollect.updateIsReady,
}})

// MARK: refresh status
function refreshTransientStatus() {
	serveIPC.windowLib.sendToValidWindow('main', 'status:all')
	serveIPC.windowLib.sendToValidWindow('mini', 'status:all')
}

// MARK: refresh list
function refreshClientModList(closeLoader = true) {
	// DATA STRUCT - send mod list
	const currentVersion = funcLib.prefs.ver()
	const pollGame       = serveIPC.storeSet.get('poll_game', true)
	serveIPC.isGamePolling = currentVersion > 17 && pollGame
	
	// updateGameRunning()
	serveIPC.windowLib.sendModList(
		{
			activeCollection       : serveIPC.gameSetOverride.index,
			cacheGameSave          : serveIPC.cacheGameSave,
			currentLocale          : serveIPC.l10n.currentLocale,
			devControls            : serveIPC.devControls,
			foldersDirty           : serveIPC.isFoldersDirty,
			foldersEdit            : serveIPC.isFoldersEdit,
			gameRunning            : serveIPC.isGameRunning,
			gameRunningEnable      : serveIPC.isGamePolling,
			isDev                  : !app.isPackaged,
			l10n                   : {
				disable    : __('override_disabled'),
				unknown    : __('override_unknown'),
			},
			modSites               : serveIPC.storeSites.store,
			pinMini                : serveIPC.windowLib.isAlwaysOnTop('mini'),
			showMini               : serveIPC.windowLib.isVisible('mini'),
		},
		'mods:list',
		'main',
		closeLoader
	)
	serveIPC.windowLib.sendToValidWindow('version', 'win:forceRefresh')
}


// MARK: FILE OPS
ipcMain.handle('file:operation', async (_, operations) => funcLib.fileOperation.process(operations))


// MARK: run scan
async function processModFolders(force = false) {
	if ( serveIPC.isProcessing ) { return }
	if ( !force && !serveIPC.isFoldersDirty ) { serveIPC.loadWindow.hide(500); return }

	serveIPC.isProcessing = true
	serveIPC.isPrefWrong  = false

	serveIPC.loadWindow.open('mods')
	serveIPC.loadWindow.total(0, true)
	serveIPC.loadWindow.current(0, true)
	serveIPC.loadWindow.doReady(() => { funcLib.processor.readOnDisk() })
}

// MARK: run scan (post)
modQueueRunner.on('process-mods-done', () => {
	funcLib.general.toggleFolderDirty(false)
	funcLib.gameSet.read()
	funcLib.gameSet.gameXML(25)
	funcLib.gameSet.gameXML(22)
	funcLib.gameSet.gameXML(19)
	funcLib.gameSet.gameXML(17)
	funcLib.gameSet.gameXML(15)
	funcLib.gameSet.gameXML(13)
	refreshClientModList()

	serveIPC.isProcessing = false

	if ( serveIPC.modCollect.isDangerMods ) {
		const trashPromises = []
		const currentSavedIgnoreList = new Set(serveIPC.storeSet.get('suppress_malware', []))

		for (const thisBadMod of serveIPC.modCollect.dangerMods ) {
			// Ignore during run, we answered once.
			if ( serveIPC.ignoreMalwareList.has(thisBadMod) ) { continue }

			const thisMod = serveIPC.modCollect.modColUUIDToRecord(thisBadMod)

			// not sure why, but sometimes this data is stale.
			if ( thisMod === null ) { continue }

			// Always ignore, user has whitelisted file
			if ( currentSavedIgnoreList.has(thisMod.fileDetail.shortName) ) { continue }
			// Always ignore, file added to master whitelist
			if ( serveIPC.whiteMalwareList.includes(thisMod.fileDetail.shortName) ) { continue }

			const thisMessage = [
				__('malware_dialog_intro'),
				'\n\n',
				__('malware_dialog_shortname'), ' : ', thisMod.fileDetail.shortName, '\n',
				__('malware_dialog_path'), ' : ', thisMod.fileDetail.fullPath, '\n',
				'\n',
				__('malware_dialog_outro'),
			].join('')

			const userChoice = dialog.showMessageBoxSync(serveIPC.windowLib.win.main, {
				cancelId  : 1,
				defaultId : 0,
				message   : thisMessage,
				title     : __('malware_dialog_title'),
				type      : 'question',
		
				buttons : [
					serveIPC.__('malware_button_delete'),
					serveIPC.__('malware_button_keep'),
					serveIPC.__('malware_button_false'),
				],
			})
			switch (userChoice) {
				case 0: {
					// delete the file.
					const fileName = path.basename(thisMod.fileDetail.fullPath)
					const pathName = serveIPC.modCollect.modColUUIDToFolder(thisBadMod)

					trashPromises.push(
						shell.trashItem(path.join(pathName, fileName)).then(() => {
							serveIPC.log.warning('malware-detector', 'Sent to trash', thisMod.fileDetail.fullPath)
							funcLib.general.toggleFolderDirty(true)
						}).catch((err) => {
							serveIPC.log.danger('malware-detector', 'Unable to remove', thisMod.fileDetail.fullPath, err)
						})
					)
					break
				}
				case 2:
					// whitelist the file, forever
					currentSavedIgnoreList.add(thisMod.fileDetail.shortName)
					serveIPC.storeSet.set('suppress_malware', [...currentSavedIgnoreList])
					serveIPC.log.warning('malware-detector', 'Whitelisted forever', thisMod.fileDetail.shortName)
					break
				default:
					// keep the file for this session only
					serveIPC.ignoreMalwareList.add(thisBadMod)
					serveIPC.log.warning('malware-detector', 'Ignoring for this session', thisMod.fileDetail.shortName)
					break
			}
		}
		Promise.allSettled(trashPromises).then(() => {
			funcLib.general.doChangelog()
			if ( trashPromises.length !== 0 ) { processModFolders() }
		})
	} else {
		funcLib.general.doChangelog()
	}
})

// MARK: APP START
app.whenReady().then(() => {
	if ( gotTheLock ) {
		if ( serveIPC.storeSet.has('force_lang') && serveIPC.storeSet.get('lock_lang', false) ) {
			// If language is locked, switch to it.
			serveIPC.l10n.currentLocale = serveIPC.storeSet.get('force_lang')
		}

		if (process.platform === 'win32') {
			app.setAppUserModelId('jtsage.fsmodassist')
		}
		
		serveIPC.windowLib.tray = new Tray(serveIPC.icon.tray)
		serveIPC.windowLib.tray.setToolTip('FSG Mod Assist')
		serveIPC.windowLib.tray.on('click', () => { serveIPC.windowLib.win.main.show() })
		serveIPC.windowLib.trayContextMenu()

		funcLib.modHub.refresh()

		// 6 hour timer on refresh
		serveIPC.interval.modHub = setInterval(() => { funcLib.modHub.refresh() }, (216e5))

		app.on('second-instance', (_, argv) => {
			// Someone tried to run a second instance, we should focus our window.
			for ( const thisArg of argv ) {
				if ( thisArg === '--start-game' ) { funcLib.gameLauncher() }
				else if ( thisArg.startsWith('--start-game-with') ) {
					funcLib.gameSet.change(thisArg.split('=')[1]).then(() => {
						funcLib.gameLauncher()
					})
				}
			}
			if ( serveIPC.windowLib.isValid('main') ) {
				if ( serveIPC.windowLib.win.main.isMinimized() || !serveIPC.windowLib.win.main.isVisible() ) { serveIPC.windowLib.win.main.show() }
				serveIPC.windowLib.win.main.focus()
			}
		})


		serveIPC.windowLib.createMainWindow(() => {
			if ( serveIPC.storeSet.has('modFolders') ) {
				serveIPC.modFolders   = new Set(serveIPC.storeSet.get('modFolders'))
				funcLib.general.toggleFolderDirty()
				setTimeout(() => {
					if ( serveIPC.isFirstRun ) { openWizard() }
					processModFolders()
				}, 1500)
			}

			serveIPC.interval.gamePoll = setInterval(() => { funcLib.general.pollGame() }, 15e3)

		})

		serveIPC.log.on('logAdded', (level, item) => { serveIPC.windowLib.sendToValidWindow('debug', 'debug:item', level, item) })

		app.on('quit',     () => {
			if ( serveIPC.windowLib.tray ) { serveIPC.windowLib.tray.destroy() }
			if ( serveIPC.watch.log ) { serveIPC.watch.log.close() }
		})
	}
})

app.on('window-all-closed', () => {	if (process.platform !== 'darwin') { app.quit() } })

