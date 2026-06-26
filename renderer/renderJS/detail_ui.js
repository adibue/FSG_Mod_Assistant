/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: DETAIL UI
/* global DATA, MA, I18N, ft_doReplace, client_BuilderPlace, clientGetKeyMapSimple, clientGetKeyMap, clientMakeCropCalendar, client_BuilderVehicle */


window.lookItemMap  = {}

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	window.state = new windowState()
})

// MARK: PAGE STATE CLASS
class windowState {
	locale     = 'en'
	i18nUnits  = {}
	modColUUID = null
	mod        = null
	storeInfo  = null

	constructor() {
		window.lookItemMap  = {}

		const urlParams = new URLSearchParams(window.location.search)
		this.modColUUID = urlParams.get('mod')

		this.getMod()
	}

	// MARK: Main logic
	async getMod() {
		this.locale    = await window.i18n.lang()
		this.i18nUnits = await window.settings.units()

		window.detail_IPC.getMod(this.modColUUID).then(async (thisResponse) => {
			this.mod       = thisResponse[0]
			this.storeInfo = thisResponse[1]
			this.#resetDynamicPage()

			I18N.local_entries = this.storeInfo.l10n[this.locale] || this.storeInfo.l10n.en || {}

			const basicPromises = [
				this.do_step_table(),
				this.do_step_keyBinds(),
				this.do_step_problems(),
				this.do_step_badges(),
				this.do_step_crops(),
			]

			if ( this.mod.modDesc.mapImage !== null ) {
				MA.byId('map_image_div').clsShow()
				MA.byId('map_image').src = this.mod.modDesc.mapImage
			}

			
			MA.byIdHTML('storeitems', '')
			MA.byId('store_div').clsShow(Object.keys(this.storeInfo.vehicles).length !== 0 || Object.keys(this.storeInfo.placeables).length !== 0)

			try {
				for ( const storeItemFile of Object.keys(this.storeInfo.vehicles).sort() ) {
					const thisItem    = this.storeInfo.vehicles[storeItemFile]
					const thisVehicle = new client_BuilderVehicle(
						storeItemFile,
						thisItem,
						this.mod.fileDetail.shortName,
						this.locale,
						this.mod.gameVersion,
						this.storeInfo.brands
					)

					thisVehicle.populateCombos(this.storeInfo)

					window.lookItemMap[thisVehicle.lookItemMap[0]] = thisVehicle.lookItemMap[1]

					MA.byIdAppend('storeitems', thisVehicle.HTML)
					thisVehicle.doCharts(this.i18nUnits)
				}

				for ( const storeItemFile of Object.keys(this.storeInfo.placeables).sort() ) {
					const thisItem  = this.storeInfo.placeables[storeItemFile]
					const thisPlace = new client_BuilderPlace(
						thisItem,
						this.locale,
						this.mod.gameVersion
					)
					MA.byIdAppend('storeitems', thisPlace.HTML)
				}
			} finally {
				Promise.allSettled(basicPromises).then((results) => {
					for ( const thisResult of results ) {
						if ( thisResult.status === 'rejected' ) {
							window.log.log('Issue with page build', thisResult.reason.toString(), thisResult.reason?.stack)
						}
					}
					ft_doReplace()
					MA.byId('loading-spinner').clsHide()
				})
			}
		}).catch((err) => {
			window.log.error('page build error',  err.message, `\n${err.stack}`)
		})

		for ( const element of MA.query('.inset-block-header-show-hide i18n-text') ) {
			element.addEventListener('click', this.showHideClicker)
		}
	}

	#resetDynamicPage() {
		window.lookItemMap = {}

		MA.byIdHTML('badges', '')
		MA.byIdHTML('problems', '')
		MA.byIdHTML('keyBinds', '')
		MA.byIdHTML('crop-table', '')
		MA.byIdHTML('storeitems', '')

		MA.byId('problem_div')?.clsShow()
		MA.byId('cropcal_div')?.clsHide()
		MA.byId('detail_crop_json')?.clsHide()
		MA.byId('store_div')?.clsHide()
		MA.byId('map_image_div')?.clsHide()
		MA.byId('malware-found')?.clsHide()
		MA.byId('download_latest_update')?.clsHide()
		MA.byId('rollback_latest_update')?.clsHide()
		MA.byId('rollback_versions')?.clsHide()
		MA.byIdHTML('rollback_versions', '')
	}

	// MARK: crops
	async do_step_crops() {
		if ( Array.isArray(this.mod.modDesc.cropInfo) ) {
			MA.byId('cropcal_div').clsShow()
			MA.byId('detail_crop_json').clsShow()
			MA.byId('cropcal_button').addEventListener('click', () => {
				window.operations.clip(JSON.stringify(this.mod.modDesc.cropInfo))
			})
			
			return clientMakeCropCalendar(
				this.mod.modDesc.cropInfo,
				this.mod.modDesc?.mapIsSouth || false,
				this.mod.modDesc?.cropWeather || null,
				this.mod.gameVersion || 22
			).then((html) => {
				MA.byIdHTML('crop-table', html)
			})
		}
	}
	
	// MARK: badges
	async do_step_badges() {
		return window.detail_IPC.getMalware().then((malware) => {
			let foundMalware = false

			const theseBadges = Array.isArray(this.mod.displayBadges) ? this.mod.displayBadges.filter((badge) => {
				if ( badge.name === 'malware' ) {
					if ( malware.dangerModsSkip.has(this.mod.fileDetail.shortName) ) { return false }
					if ( malware.suppressList.includes(this.mod.fileDetail.shortName)) { return false }
					foundMalware = true
				}
				return true
			}) : []

			MA.byId('malware-found').clsShow(foundMalware)

			const badgePromise = theseBadges.map((badge) => I18N.buildBadgeMod(badge))

			return Promise.allSettled(badgePromise).then((badges) => {
				badges.map((x) => {
					MA.byId('badges').appendChild(x.value)
				})
			})
		})
	}

	// MARK: problems
	async do_step_problems() {
		return window.detail_IPC.getBinds().then(async (bindConflicts) => {
			const bindingIssue     = bindConflicts[this.mod.currentCollection][this.mod.fileDetail.shortName] ?? null

			if ( this.mod.issues.length === 0 && bindingIssue === null ) {
				MA.byId('problem_div').clsHide()
			} else {
				return Promise.allSettled([
					...await this.#do_subStep_issues(),
					...await this.#do_subStep_binds(bindingIssue),
				]).then((value) => {
					const theseIssues = value.map((item) => `<tr class="py-2"><td class="px-2">${DATA.checkX(0, false)}</td><td>${item.value}</td></tr>`)
					MA.byIdHTML('problems', `<table class="table table-borderless mb-0">${theseIssues.join('')}</table>`)
				})
			}
		})
	}

	// MARK: keyBinds
	async do_step_keyBinds() {
		const keyBinds = []
		for ( const action in this.mod.modDesc.binds ) {
			const thisBinds = this.mod.modDesc.binds[action].map((keyCombo) => clientGetKeyMapSimple(keyCombo, this.locale))
			keyBinds.push(`${action} :: ${thisBinds.join('<span class="mx-3">/</span>')}`)
		}
		return DATA.joinArrayOrI18N(keyBinds, 'detail_key_none').then((value) => {
			MA.byIdHTML('keyBinds', value)
			MA.byId('keyBinds').clsOrGateArr(keyBinds, 'text-info')
		})
		
	}

	// MARK: table (top)
	async do_step_table() {
		const joinedArrays = {
			bigFiles       : [this.mod.fileDetail.tooBigFiles],
			depends        : [this.mod.modDesc.depend, 'detail_depend_clean'],
			extraFiles     : [this.mod.fileDetail.extraFiles],
			pngTexture     : [this.mod.fileDetail.pngTexture],
			spaceFiles     : [this.mod.fileDetail.spaceFiles],
		}
		for ( const [id, content] of Object.entries(joinedArrays)) {
			DATA.joinArrayOrI18N(...content).then((value) => {
				MA.byIdHTML(id, value)
				MA.byId(id).clsOrGateArr(content[0])
			})
		}

		const tempTitle = this.#doL10N(this.mod.l10n.title)
		const sourceURL = await window.settings.site(this.mod.fileDetail.shortName, false)
		const collectionName = await window.detail_IPC.collectName(this.mod.currentCollection)

		const idMap = {
			description    : this.#doL10N(this.mod.l10n.description),
			file_date      : (new Date(Date.parse(this.mod.fileDetail.fileDate))).toLocaleString(this.locale, {timeZoneName : 'short'}),
			filesize       : await DATA.bytesToHR(this.mod.fileDetail.fileSize),
			github_version : this.#isGitHubURL(sourceURL) ? I18N.defer('update_status_checking', false) : `<em>${I18N.defer('update_source_not_configured', false )}</em>`,
			has_scripts    : DATA.checkX(this.mod.modDesc.scriptFiles),
			i3dFiles       : this.mod.fileDetail.i3dFiles.join('\n'),
			is_multiplayer : DATA.checkX(this.mod.modDesc.multiPlayer, false),
			mh_version     : ( this.mod.modHub.id !== null ) ?
				`<a href="https://www.farming-simulator.com/mod.php?mod_id=${this.mod.modHub.id}" target="_BLANK">${this.mod.modHub.version}</a>` :
				`<em>${I18N.defer(this.mod.modHub.id === null ? 'mh_norecord' : 'mh_unknown', false )}</em>`,
			mod_author     : DATA.escapeSpecial(this.mod.modDesc.author),
			mod_collection : `${I18N.defer('detail_mod_collection', false)}: ${DATA.escapeSpecial(collectionName ?? this.mod.currentCollection)}`,
			mod_location   : this.mod.fileDetail.fullPath,
			store_items    : DATA.checkX(this.mod.modDesc.storeItems),
			title          : (( tempTitle !== '--' ) ? tempTitle : this.mod.fileDetail.shortName),
			update_source  : this.#updateSourceHTML(sourceURL),
			update_status  : this.#isGitHubURL(sourceURL) ? I18N.defer('update_status_checking', false) : `<em>${I18N.defer('update_source_not_configured', false )}</em>`,
			version        : DATA.escapeSpecial(this.mod.modDesc.version),
		}
		for ( const [id, content] of Object.entries(idMap)) {
			MA.byIdHTML(id, content)
		}

		for ( const element of MA.query('#description a') ) { element.target = '_BLANK' }

		MA.byIdValue('update_source_input', sourceURL)
		MA.byIdEventIfExists('update_source_save', () => { this.#updateSourceSave() })
		MA.byIdEventIfExists('update_source_clear', () => { this.#updateSourceClear() })
		this.#refreshGitHubVersion(sourceURL)

		MA.byIdHTMLorHide(
			'icon_div',
			`<img class="img-fluid" src="${this.mod.modDesc.iconImage}" />`,
			this.mod.modDesc.iconImage
		)
	}

	#updateSourceHTML(sourceURL) {
		if ( sourceURL !== '' ) {
			const safeURL = DATA.escapeSpecial(sourceURL)
			const label   = this.#isGitHubURL(sourceURL) ? 'GitHub' : I18N.defer('update_source_custom', false)
			return `<a href="${safeURL}" target="_BLANK">${label}</a>`
		}

		if ( this.mod.modHub.id !== null ) {
			return `<a href="https://www.farming-simulator.com/mod.php?mod_id=${this.mod.modHub.id}" target="_BLANK">ModHub</a>`
		}

		return `<em>${I18N.defer('update_source_not_configured', false )}</em>`
	}

	#isGitHubURL(sourceURL) {
		try {
			return new URL(sourceURL).hostname.toLowerCase() === 'github.com'
		} catch {
			return false
		}
	}

	#normalizedGitHubURL(sourceURL) {
		try {
			const url = new URL(sourceURL)
			if ( url.protocol !== 'https:' ) { return null }
			if ( url.hostname.toLowerCase() !== 'github.com' ) { return null }
			const parts = url.pathname.split('/').filter((item) => item !== '')
			if ( parts.length < 2 ) { return null }
			url.hash = ''
			return url.toString()
		} catch {
			return null
		}
	}

	#updateSourceSave() {
		const sourceURL = this.#normalizedGitHubURL(MA.byIdValue('update_source_input').trim())

		if ( sourceURL === null ) {
			MA.byId('update_source_input').classList.add('is-invalid')
			return
		}

		MA.byId('update_source_input').classList.remove('is-invalid')
		window.settings.site(this.mod.fileDetail.shortName, sourceURL).then((value) => {
			MA.byIdValue('update_source_input', value)
			MA.byIdHTML('update_source', this.#updateSourceHTML(value))
			this.#refreshGitHubVersion(value)
		})
	}

	#updateSourceClear() {
		MA.byId('update_source_input').classList.remove('is-invalid')
		window.settings.site(this.mod.fileDetail.shortName, '').then((value) => {
			MA.byIdValue('update_source_input', value)
			MA.byIdHTML('update_source', this.#updateSourceHTML(value))
			this.#refreshGitHubVersion(value)
		})
	}

	#refreshGitHubVersion(sourceURL) {
		if ( !this.#isGitHubURL(sourceURL) ) {
			const updatePointer = this.#updatePointer(null, sourceURL)
			MA.byIdHTML('github_version', `<em>${I18N.defer('update_source_not_configured', false )}</em>`)
			MA.byIdHTML('update_status', `<em>${I18N.defer('update_source_not_configured', false )}</em>`)
			MA.byId('download_latest_update')?.clsHide()
			window.detail_IPC.hasRollbackBackup(updatePointer).then((hasRollbackBackup) => {
				this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
				this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
			})
			return
		}

		MA.byIdText('github_version', I18N.defer('update_status_checking', false))
		MA.byIdText('update_status', I18N.defer('update_status_checking', false))

		window.detail_IPC.getGitHub(sourceURL).then(async (result) => {
			const updatePointer = this.#updatePointer(result.assetName ?? null, sourceURL)
			if ( !result.ok ) {
				MA.byIdHTML('github_version', `<em>${I18N.defer(result.error === 'no_release_or_tag' ? 'update_status_no_github_release' : 'update_status_failed', false )}</em>`)
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
				MA.byId('download_latest_update')?.clsHide()
				const hasRollbackBackup = await window.detail_IPC.hasRollbackBackup(updatePointer)
				this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
				this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
				return
			}

			const hasRollbackBackup = await window.detail_IPC.hasRollbackBackup(updatePointer)
			const safeVersion = DATA.escapeSpecial(result.version)
			const safeURL     = DATA.escapeSpecial(result.url)
			MA.byIdHTML('github_version', `<a href="${safeURL}" target="_BLANK">${safeVersion}</a>`)
			MA.byIdHTML('update_status', this.#versionStatusHTML(this.mod.modDesc.version, result.version, hasRollbackBackup))
			this.#refreshDownloadButton(result, updatePointer)
			this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
			this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
		}).catch(() => {
			MA.byIdHTML('github_version', `<em>${I18N.defer('update_status_failed', false )}</em>`)
			MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
			MA.byId('download_latest_update')?.clsHide()
			MA.byId('rollback_latest_update')?.clsHide()
			MA.byId('rollback_versions')?.clsHide()
		})
	}

	#updatePointer(fileName = null, sourceURL = null) {
		return {
			collectionKey : this.mod.currentCollection,
			fileName      : fileName,
			modName       : this.mod.fileDetail.shortName,
			sourceURL     : sourceURL,
		}
	}

	#refreshDownloadButton(result, updatePointer) {
		const downloadButton = MA.byId('download_latest_update')
		if ( downloadButton === null ) { return }

		const compareResult = DATA.versionCompare(this.mod.modDesc.version, result.version)
		const isUpdate = compareResult < 0 || (Number.isNaN(compareResult) && DATA.versionDifferent(this.mod.modDesc.version, result.version))
		const canDownload = isUpdate && result.hasDownload && typeof result.downloadURL === 'string' && typeof result.assetName === 'string'

		downloadButton.clsShow(canDownload)
		downloadButton.disabled = !canDownload
		downloadButton.onclick = null
		if ( !canDownload ) { return }

		downloadButton.onclick = async () => {
			downloadButton.disabled = true
			MA.byIdHTML('update_status', I18N.defer('update_list_updating', false))
			const collectionName = await window.detail_IPC.collectName(updatePointer.collectionKey)
			const resultDownload = await window.detail_IPC.downloadApplySelected([{
				collectionKey  : updatePointer.collectionKey,
				collectionName : collectionName,
				fileName       : result.assetName,
				modName         : updatePointer.modName,
				sourceURL       : updatePointer.sourceURL,
				url             : result.downloadURL,
				version         : result.version,
			}])

			if ( resultDownload.ok ) {
				downloadButton.clsHide()
				MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_updated', false)}: ${DATA.escapeSpecial(result.version)}</span>`)
				this.getMod()
			} else {
				downloadButton.disabled = false
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_list_update_failed', false)} ${DATA.escapeSpecial(resultDownload.error)}</span>`)
			}
		}
	}

	#versionMatchesCurrent(version) {
		if ( typeof version !== 'string' || version === '' ) { return false }
		const compareResult = DATA.versionCompare(this.mod.modDesc.version, version)
		return compareResult === 0 || (Number.isNaN(compareResult) && !DATA.versionDifferent(this.mod.modDesc.version, version))
	}

	async #refreshRollbackVersions(updatePointer, hasRollbackBackup = false) {
		const rollbackDiv = MA.byId('rollback_versions')
		if ( rollbackDiv === null ) { return }

		const entries = await window.detail_IPC.rollbackEntries(updatePointer)
		if ( entries.length === 0 ) {
			rollbackDiv.clsHide()
			rollbackDiv.innerHTML = ''
			return
		}

		MA.byId('rollback_latest_update')?.clsHide()
		rollbackDiv.clsShow()
		rollbackDiv.innerHTML = `
			<div class="border rounded p-2">
				<div class="fw-bold mb-2">Available rollback versions</div>
				<div class="d-grid gap-2" id="rollback_version_list"></div>
			</div>`

		const listDiv = MA.byId('rollback_version_list')
		for ( const [index, entry] of entries.entries() ) {
			const versionLabel = entry.previousVersion ?? entry.currentVersion ?? (entry.backupHash !== null ? entry.backupHash.slice(0, 12) : 'backup')
			const isCurrentVersion = this.#versionMatchesCurrent(entry.previousVersion ?? entry.currentVersion)
			const timestamp = entry.timestamp === null ?
				'Unknown date' :
				new Date(Date.parse(entry.timestamp)).toLocaleString(this.locale, { timeZoneName : 'short' })
			const sourceLabel = entry.source ?? 'Backup'
			const template = document.createElement('template')
			template.innerHTML = `
				<div class="bg-secondary bg-opacity-25 rounded p-2">
					<div class="d-flex flex-wrap justify-content-between gap-2">
						<div>
							<div class="fw-bold">Version ${DATA.escapeSpecial(versionLabel)}</div>
							<div class="small">${DATA.escapeSpecial(timestamp)}</div>
							<div class="small">${DATA.escapeSpecial(sourceLabel)}</div>
						</div>
						<button class="btn btn-sm ${isCurrentVersion ? 'btn-secondary' : 'btn-info'} rollback-version-button" type="button" data-index="${index}" ${isCurrentVersion ? 'disabled' : ''}>${isCurrentVersion ? 'Current version' : 'Restore this version'}</button>
					</div>
				</div>
			`
			const row = template.content.firstElementChild
			if ( isCurrentVersion ) {
				listDiv.appendChild(row)
				continue
			}

			row.querySelector('.rollback-version-button').addEventListener('click', async (event) => {
				const button = event.currentTarget
				button.disabled = true
				MA.byIdHTML('update_status', I18N.defer('update_status_rollback_applying', false))
				const result = await window.detail_IPC.rollbackEntry(entry)
				if ( result.ok ) {
					MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_rollback_restored', false)}</span>`)
					this.getMod()
				} else {
					button.disabled = false
					MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_rollback_failed', false)} ${DATA.escapeSpecial(result.error)}</span>`)
				}
			})
			listDiv.appendChild(row)
		}

		if ( !hasRollbackBackup ) { MA.byId('rollback_latest_update')?.clsHide() }
	}

	#refreshRollbackButton(updatePointer, hasRollbackBackup) {
		const rollbackButton = MA.byId('rollback_latest_update')
		if ( rollbackButton === null ) { return }

		rollbackButton.clsShow(hasRollbackBackup)
		if ( !hasRollbackBackup ) { return }

		rollbackButton.onclick = async () => {
			rollbackButton.disabled = true
			MA.byIdHTML('update_status', I18N.defer('update_status_rollback_applying', false))
			const result = await window.detail_IPC.rollbackLatest(updatePointer)
			if ( result.ok ) {
				MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_rollback_restored', false)}</span>`)
				rollbackButton.clsHide()
				this.getMod()
			} else {
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_rollback_failed', false)} ${DATA.escapeSpecial(result.error)}</span>`)
				rollbackButton.disabled = false
			}
		}
	}

	#versionStatusHTML(localVersion, remoteVersion, hasRollbackBackup = false) {
		if ( hasRollbackBackup ) {
			return `<span class="text-info">${I18N.defer('update_status_rollback_available', false)}</span>`
		}
		const compareResult = DATA.versionCompare(localVersion, remoteVersion)
		if ( compareResult < 0 ) {
			return `<span class="text-warning">${I18N.defer('update_status_available', false)}</span>`
		}
		if ( Number.isNaN(compareResult) && DATA.versionDifferent(localVersion, remoteVersion) ) {
			return `<span class="text-warning">${I18N.defer('update_status_available', false)}</span>`
		}
		if ( compareResult === 0 ) {
			return `<span class="text-success">${I18N.defer('update_status_current', false)}</span>`
		}
		return `<span class="text-info">${I18N.defer('update_status_unknown', false)}</span>`
	}

	// MARK: SUB binds
	async #do_subStep_binds(bindingIssue) {
		const problemPromises = []
		if ( bindingIssue !== null ) {
			for ( const keyCombo in bindingIssue ) {
				const actualKey = clientGetKeyMap(keyCombo, this.locale)
				const confList  = bindingIssue[keyCombo].join(', ')
				const i18n      = I18N.defer('bind_conflict')
				problemPromises.push(
					`${i18n} : ${actualKey} :: ${confList}`
				)
			}
		}
		return problemPromises
	}
	// MARK: SUB issues
	async #do_subStep_issues() {
		const problemI18N = []
		for ( const issue of this.mod.issues ) {

			const issueI18N = I18N.defer(issue, false)
			if ( issue === 'FILE_ERROR_LIKELY_COPY' && this.mod.fileDetail.copyName !== false ) {
				const copyI18N = I18N.defer('file_error_copy_name', false)
				problemI18N.push(`${issueI18N} ${copyI18N} ${this.mod.fileDetail.copyName}${this.mod.fileDetail.isFolder?'':'.zip'}`)
			} else {
				problemI18N.push(issueI18N)
			}
		}
		return problemI18N
	}

	#doL10N(item) {
		let returnText = item?.[this.locale]
		returnText ??= item?.en
		returnText ??= item?.de
		returnText ??= '--'
		return DATA.escapeSpecial(returnText)
	}

	// MARK: CLICKERS
	showHideClicker(e) {
		const isShow      = e.target.classList.contains('section_show')
		const buttonGroup = e.target.parentElement
		const section     = e.target.parentElement.parentElement.querySelector('div')

		section.clsShow(isShow)
		buttonGroup.children[0].clsShow(!isShow)
		buttonGroup.children[1].clsShow(isShow)
	}
}
