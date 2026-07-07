/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: UPDATE UI

/* global MA, DATA, I18N */

function doL10N(item, locale) {
	let returnText = item?.[locale]
	returnText ??= item?.en
	returnText ??= item?.de
	returnText ??= '--'
	return DATA.escapeSpecial(returnText)
}

function isGitHubURL(sourceURL) {
	try {
		return new URL(sourceURL).hostname.toLowerCase() === 'github.com'
	} catch {
		return false
	}
}

function isWebURL(sourceURL) {
	try {
		return new URL(sourceURL).protocol === 'https:'
	} catch {
		return false
	}
}

// eslint-disable-next-line complexity
function makeCandidateMap(modCollect) {
	const thisVersion    = modCollect.appSettings.game_version
	const candidates     = {}
	const collectKeyName = {}
	const activeCollect  = modCollect.opts?.activeCollection ?? null
	const modSites       = modCollect.opts?.modSites ?? {}
	const collectionKeys = [...modCollect.set_Collections]
	const collectKeys    = activeCollect !== null && collectionKeys.includes(activeCollect) ?
		[activeCollect] :
		collectionKeys

	for ( const collectKey of collectKeys ) {
		const theseNotes = modCollect?.collectionNotes?.[collectKey]

		if ( theseNotes?.notes_frozen === true ) { continue }
		if ( theseNotes?.notes_version !== thisVersion ) { continue }

		collectKeyName[collectKey] = modCollect.collectionToName[collectKey]

		for ( const modKey of modCollect.modList[collectKey].modSet ) {
			const thisMod  = modCollect.modList[collectKey].mods[modKey]
			const modName  = thisMod.fileDetail.shortName
			const sourceURL = modSites[modName] ?? ''

			if ( thisMod.fileDetail.isFolder ) { continue }

			const addCandidate = (sourceType, sourceLink, remoteVersion = null, modHubID = null) => {
				const candidateKey = `${modName}::${sourceType}`
				candidates[candidateKey] ??= {
					collectionKeys : [],
					collections : [],
					icon        : thisMod.modDesc.iconImage,
					local       : new Set(),
					modHubID,
					modName,
					remoteVersion,
					sourceLabel : sourceType === 'github' ? 'GitHub' : 'ModHub',
					sourceType,
					sourceURL   : sourceLink,
					title       : doL10N(thisMod.l10n.title, modCollect.appSettings.force_lang),
				}
				if ( !candidates[candidateKey].collectionKeys.includes(collectKey) ) {
					candidates[candidateKey].collectionKeys.push(collectKey)
					candidates[candidateKey].collections.push(collectKeyName[collectKey])
				}
				candidates[candidateKey].local.add(thisMod.modDesc.version)
			}

			if ( isGitHubURL(sourceURL) ) { addCandidate('github', sourceURL) }
			if ( thisMod.modHub.id !== null && typeof thisMod.modHub.version === 'string' && thisMod.modHub.version !== '' ) {
				addCandidate('modhub', `https://www.farming-simulator.com/mod.php?mod_id=${thisMod.modHub.id}`, thisMod.modHub.version, thisMod.modHub.id)
			}
		}
	}

	return candidates
}

function isUpdateAvailable(localVersions, remoteVersion, allowUnknownDifference = false) {
	for ( const localVersion of localVersions ) {
		const compare = DATA.versionCompare(localVersion, remoteVersion)
		if ( compare < 0 || (allowUnknownDifference && Number.isNaN(compare) && DATA.versionDifferent(localVersion, remoteVersion)) ) {
			return true
		}
	}
	return false
}

function statusText(result) {
	if ( result.ok ) {
		return I18N.defer('update_status_available', false)
	}
	if ( result.error === 'no_release_or_tag' ) {
		return I18N.defer('update_status_no_github_release', false)
	}
	return I18N.defer('update_status_failed', false)
}

function downloadStatusText(result) {
	if ( result.source === 'modhub' && !result.hasDownload ) {
		return '<span class="badge text-bg-secondary">Manual download from ModHub</span>'
	}
	if ( result.hasDownload ) {
		const downloadLabel = result.downloadSource === 'repositoryFile' ?
			I18N.defer('update_list_repo_zip_available', false) :
			I18N.defer('update_list_download_available', false)
		return `<span class="badge text-bg-success">${downloadLabel}</span> <span class="small">${DATA.escapeSpecial(result.assetName)}</span>`
	}
	if ( result.source === 'release' ) {
		return `<span class="badge text-bg-warning">${I18N.defer('update_list_no_zip_asset', false)}</span>`
	}
	return `<span class="badge text-bg-secondary">${I18N.defer('update_list_source_newer_manual', false)}</span>`
}

function withTimeout(promise, timeoutMS = 15000) {
	return Promise.race([
		promise,
		new Promise((resolve) => {
			setTimeout(() => {
				resolve({ ok : false, error : 'timeout' })
			}, timeoutMS)
		}),
	])
}

async function mapWithConcurrency(entries, limit, mapper) {
	const results = new Array(entries.length)
	let nextIndex = 0
	const worker = async () => {
		const currentIndex = nextIndex++
		if ( currentIndex >= entries.length ) { return }
		results[currentIndex] = await mapper(entries[currentIndex])
		return worker()
	}
	await Promise.all(Array.from({ length : Math.min(limit, entries.length) }, () => worker()))
	return results
}

let activeRenderID = 0
let activeCollectionKey = null
let manifestResolvedMods = []

function collectionContextText(modCollect) {
	const activeCollect   = modCollect.opts?.activeCollection ?? null
	const collectionName  = activeCollect === null ? null : modCollect.collectionToName?.[activeCollect]
	const collectionLabel = collectionName ?? 'All monitored collections'
	return `Checking updates for: ${DATA.escapeSpecial(collectionLabel)}`
}

function renderEmpty(messageKey) {
	MA.byIdHTML('modList', '')
	MA.byIdHTML('updateStatus', I18N.defer(messageKey, false))
	MA.byId('selectionControls').classList.add('d-none')
	updateSelectedCount()
}

function getUpdateCheckboxes() {
	return [...document.querySelectorAll('.update-select-checkbox')]
}

function updateSelectedCount() {
	const selectedCount = getSelectedCheckboxes().length
	const downloadableCount = getSelectedDownloadCandidates().length
	MA.byIdHTML('selectedCount', `${I18N.defer('update_list_selected', false)} ${selectedCount}`)
	MA.byId('openSelectedButton').disabled = selectedCount === 0
	MA.byId('downloadSelectedButton').disabled = downloadableCount === 0
}

function setAllSelections(isChecked) {
	for ( const checkbox of getUpdateCheckboxes() ) {
		checkbox.checked = isChecked
	}
	updateSelectedCount()
}

function getSelectedCheckboxes() {
	return getUpdateCheckboxes().filter((checkbox) => checkbox.checked)
}

function openSelectedSources() {
	for ( const checkbox of getSelectedCheckboxes() ) {
		if ( isWebURL(checkbox.dataset.sourceUrl) ) {
			window.update_IPC.openURL(checkbox.dataset.sourceUrl)
		}
	}
}

function getSelectedDownloadCandidates() {
	return getSelectedCheckboxes()
		.filter((checkbox) => typeof checkbox.dataset.downloadUrl === 'string')
		.map((checkbox) => ({
			collectionKey : checkbox.dataset.collectionKey,
			collectionName : checkbox.dataset.collectionName,
			fileName : checkbox.dataset.assetName,
			modHubID : checkbox.dataset.modHubId,
			modName  : checkbox.dataset.modName,
			sourceType : checkbox.dataset.sourceType,
			sourceURL : checkbox.dataset.sourceUrl,
			url      : checkbox.dataset.downloadUrl,
			version  : checkbox.dataset.remoteVersion,
		}))
}

async function downloadSelectedZIPs() {
	const downloads = getSelectedDownloadCandidates()
	if ( downloads.length === 0 ) { return }

	MA.byId('downloadSelectedButton').disabled = true
	MA.byIdHTML('updateStatus', I18N.defer('update_list_updating', false))
	const result = await window.update_IPC.downloadApplySelected(downloads)
	if ( result.ok ) {
		const modCollect = await window.update_IPC.get()
		await startFromModList(modCollect)
		MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_complete', false)} ${result.count} / ${downloads.length}`)
	} else {
		MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_failed', false)} ${result.error}`)
	}
	updateSelectedCount()
}

async function displayCandidates(candidates, renderID, forceRemoteRefresh = false) {
	const listDiv = MA.byId('modList')
	const candidateEntries = Object.entries(candidates).sort((a, b) => Intl.Collator().compare(a[0], b[0]))
	let completeCount = 0

	listDiv.innerHTML = ''

	if ( candidateEntries.length === 0 ) {
		renderEmpty('update_list_no_sources')
		return
	}

	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} 0 / ${candidateEntries.length}`)

	const updateRows = (await mapWithConcurrency(candidateEntries, 6, async ([, entry]) => {
		const result = entry.sourceType === 'github' ?
			await withTimeout(window.update_IPC.getGitHub(entry.sourceURL, forceRemoteRefresh)) :
			await withTimeout(window.update_IPC.getModHub(entry.modHubID, forceRemoteRefresh))
		completeCount++
		if ( renderID === activeRenderID ) {
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${completeCount} / ${candidateEntries.length}`)
		}

		if ( !result.ok ) { return null }
		if ( !isUpdateAvailable(entry.local, result.version, entry.sourceType === 'github') ) { return null }
	
		const collectionList = entry.collections
			.sort((a, b) => Intl.Collator().compare(a, b))
			.map((collection) => `<li><span class="fw-bold">${DATA.escapeSpecial(collection)}</span></li>`)
		const assetName = result.assetName ?? null
		const collectionKey = entry.collectionKeys[0] ?? null
		const collectionName = entry.collections[0] ?? 'updates'
		return {
			assetName      : assetName,
			collectionKey  : collectionKey,
			collectionName : collectionName,
			downloadURL    : result.downloadURL ?? null,
			modHubID       : entry.modHubID,
			modName        : entry.modName,
			node           : DATA.templateEngine('update_line', {
				collections   : collectionList.join(''),
				downloadStatus : downloadStatusText(result),
				iconImage     : `<img class="img-fluid" src="${DATA.iconMaker(entry.icon)}" />`,
				localVersion  : DATA.escapeSpecial([...entry.local].sort().join(', ')),
				realName      : entry.title,
				remoteVersion : DATA.escapeSpecial(result.version),
				shortName     : DATA.escapeSpecial(entry.modName),
				sourceName    : DATA.escapeSpecial(entry.sourceLabel),
				statusText    : statusText(result),
			}),
			sourceType : entry.sourceType,
			sourceURL : entry.sourceURL,
			version   : result.version,
		}
	})).filter((x) => x !== null)

	if ( renderID !== activeRenderID ) { return }

	for ( const { assetName, collectionKey, collectionName, downloadURL, modHubID, modName, node, sourceType, sourceURL, version } of updateRows ) {
		node.firstElementChild.classList.add('bg-warning-subtle')
		const selectCheckbox = node.querySelector('.update-select-checkbox')
		if ( assetName !== null ) {
			selectCheckbox.dataset.assetName = assetName
			selectCheckbox.dataset.collectionName = collectionName
			selectCheckbox.dataset.collectionKey = collectionKey
			selectCheckbox.dataset.modHubId = modHubID ?? ''
			selectCheckbox.dataset.modName = modName
		}
		if ( downloadURL !== null ) { selectCheckbox.dataset.downloadUrl = downloadURL }
		selectCheckbox.dataset.remoteVersion = version
		selectCheckbox.dataset.sourceUrl = sourceURL
		selectCheckbox.dataset.sourceType = sourceType
		selectCheckbox.addEventListener('change', updateSelectedCount)
		const sourceButton = node.querySelector('.update-source-button')
		sourceButton.dataset.sourceUrl = sourceURL
		sourceButton.addEventListener('click', (event) => {
			const buttonURL = event.currentTarget.dataset.sourceUrl
			if ( isWebURL(buttonURL) ) {
				window.update_IPC.openURL(buttonURL)
			}
		})
		listDiv.appendChild(node)
	}

	MA.byId('selectionControls').classList.toggle('d-none', updateRows.length === 0)
	updateSelectedCount()

	MA.byIdHTML(
		'updateStatus',
		updateRows.length === 0 ? I18N.defer('update_list_none_found', false) : `${updateRows.length} ${I18N.defer('update_list_found', false)}`
	)
}

async function startFromModList(modCollect, forceRemoteRefresh = false) {
	const renderID = ++activeRenderID

	if ( modCollect === null ) {
		renderEmpty('update_list_load_failed')
		return
	}
	try {
		activeCollectionKey = modCollect.opts?.activeCollection ?? null
		MA.byIdHTML('updateCollectionContext', collectionContextText(modCollect))
		MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
		MA.byIdHTML('modList', '')
		MA.byId('selectionControls').classList.add('d-none')
		updateSelectedCount()
		await displayCandidates(makeCandidateMap(modCollect), renderID, forceRemoteRefresh)
	} catch (err) {
		MA.byIdText('updateStatus', `Update list error: ${err.message}`)
	}
}

async function refreshUpdateCandidates() {
	const button = MA.byId('refreshUpdatesButton')
	button.disabled = true
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	try {
		const modCollect = await window.update_IPC.get()
		await startFromModList(modCollect, true)
	} finally {
		button.disabled = false
	}
}

function manifestStateBadge(state) {
	if ( state === 'downloadable' ) { return '<span class="badge text-bg-success">Latest ZIP available</span>' }
	if ( state === 'manual' ) { return '<span class="badge text-bg-warning">Manual download</span>' }
	return '<span class="badge text-bg-danger">Source missing</span>'
}

function manifestStateDetail(mod) {
	if ( mod.state === 'downloadable' ) { return `${DATA.escapeSpecial(mod.sourceType === 'modhub' ? 'ModHub' : 'GitHub')} can supply this mod automatically.` }
	if ( mod.state === 'manual' ) { return 'A source page is known, but no safe automatic ZIP download is available.' }
	return 'No supported update source was included. Ask the collection author for this mod.'
}

function manifestSelectionChanged() {
	const selected = [...document.querySelectorAll('.manifest-select:checked')].length
	MA.byId('manifestInstall').disabled = selected === 0 || MA.byId('manifestCollection').value === ''
}

function setManifestSelections(checked) {
	for ( const checkbox of document.querySelectorAll('.manifest-select:not(:disabled)') ) {
		checkbox.checked = checked
	}
	manifestSelectionChanged()
}

function applyManifestViewFilter(filter) {
	for ( const row of document.querySelectorAll('.manifest-row') ) {
		row.classList.toggle('d-none', filter === 'attention' && row.dataset.state === 'downloadable')
	}
	const showAll = MA.byId('manifestShowAll')
	const showAttention = MA.byId('manifestShowAttention')
	showAll.classList.toggle('active', filter === 'all')
	showAll.classList.toggle('btn-secondary', filter === 'all')
	showAll.classList.toggle('btn-outline-secondary', filter !== 'all')
	showAttention.classList.toggle('active', filter === 'attention')
	showAttention.classList.toggle('btn-danger', filter === 'attention')
	showAttention.classList.toggle('btn-outline-danger', filter !== 'attention')
}

function renderManifestPreview(result) {
	manifestResolvedMods = result.mods
	const list = MA.byId('manifestList')
	list.innerHTML = ''
	const counts = { downloadable : 0, manual : 0, missing : 0 }

	for ( const [index, mod] of result.mods.entries() ) {
		counts[mod.state]++
		const localText = mod.localVersions.length === 0 ? 'not currently stored locally' : `local: ${mod.localVersions.join(', ')}`
		const remoteText = mod.remoteVersion === null ? `shared version: ${mod.requestedVersion ?? 'unknown'}` : `latest: ${mod.remoteVersion}`
		const node = DATA.templateEngine('manifest_line', {
			detail     : manifestStateDetail(mod),
			modName    : DATA.escapeSpecial(mod.modName),
			stateBadge : manifestStateBadge(mod.state),
			versions   : `${DATA.escapeSpecial(remoteText)}; ${DATA.escapeSpecial(localText)}`,
		})
		const row = node.firstElementChild
		row.dataset.state = mod.state
		if ( mod.state === 'missing' ) { row.classList.add('bg-danger-subtle', 'border-danger') }
		if ( mod.state === 'manual' ) { row.classList.add('bg-warning-subtle', 'border-warning') }
		const checkbox = node.querySelector('.manifest-select')
		checkbox.dataset.index = index
		checkbox.disabled = mod.state !== 'downloadable'
		checkbox.addEventListener('change', manifestSelectionChanged)
		const sourceButton = node.querySelector('.manifest-source-button')
		if ( isWebURL(mod.sourceURL) ) {
			sourceButton.classList.remove('d-none')
			sourceButton.addEventListener('click', () => window.update_IPC.openURL(mod.sourceURL))
		}
		list.appendChild(node)
	}

	MA.byIdText('manifestTitle', `${result.manifest.collection.name} — ${result.mods.length} mods`)
	MA.byIdText('manifestSummary', `${counts.downloadable} automatic, ${counts.manual} manual, ${counts.missing} missing.`)
	MA.byId('manifestPreview').classList.remove('d-none')
	applyManifestViewFilter('all')
	setManifestSelections(false)
}

async function loadManifestCollections() {
	const collections = await window.update_IPC.collectionManifestCollections()
	const select = MA.byId('manifestCollection')
	const previousValue = select.value
	select.innerHTML = '<option value="">Choose a collection...</option>'
	for ( const collection of collections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}
	if ( collections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	} else if ( collections.some((collection) => collection.key === activeCollectionKey) ) {
		select.value = activeCollectionKey
	}
	manifestSelectionChanged()
}

async function toggleManifestPanel() {
	const panel = MA.byId('manifestPanel')
	panel.classList.toggle('d-none')
	if ( !panel.classList.contains('d-none') ) { await loadManifestCollections() }
}

async function exportManifest(mode) {
	const collectionKey = MA.byId('manifestCollection').value
	if ( collectionKey === '' ) {
		MA.byIdText('manifestStatus', 'Choose the collection you want to share first.')
		return
	}
	MA.byIdText('manifestStatus', 'Preparing collection manifest...')
	const result = await window.update_IPC.exportCollectionManifest({ collectionKey, mode })
	if ( result.ok ) {
		const detail = mode === 'clipboard' ? `Share link copied (${result.length.toLocaleString()} characters).` : `Manifest saved to ${result.filePath}`
		MA.byIdText('manifestStatus', `${detail} ${result.count} mods included.`)
	} else if ( !result.canceled ) {
		MA.byIdText('manifestStatus', `Manifest export failed: ${result.error}`)
	}
}

async function importManifest(mode) {
	MA.byIdText('manifestStatus', 'Reading manifest and checking the latest supported sources...')
	MA.byId('manifestPreview').classList.add('d-none')
	const result = mode === 'clipboard' ?
		await window.update_IPC.importCollectionManifestClipboard() :
		await window.update_IPC.importCollectionManifestFile()
	if ( result.ok ) {
		renderManifestPreview(result)
		MA.byIdText('manifestStatus', 'Manifest resolved. Review the results before installing anything.')
	} else if ( !result.canceled ) {
		MA.byIdText('manifestStatus', `Manifest import failed: ${result.error}`)
	}
}

async function installManifestSelection() {
	const collectionKey = MA.byId('manifestCollection').value
	const downloads = [...document.querySelectorAll('.manifest-select:checked')]
		.map((checkbox) => manifestResolvedMods[Number.parseInt(checkbox.dataset.index, 10)])
	if ( collectionKey === '' || downloads.length === 0 ) { return }

	MA.byId('manifestInstall').disabled = true
	MA.byIdText('manifestStatus', `Installing ${downloads.length} selected mod(s)...`)
	const result = await window.update_IPC.installCollectionManifest({ collectionKey, downloads })
	if ( result.ok ) {
		const failedNames = result.results.filter((entry) => entry.ok === false).map((entry) => entry.modName)
		const failedText = result.failed === 0 ? '' : ` ${result.failed} failed: ${failedNames.join(', ')}.`
		MA.byIdText('manifestStatus', `Collection import complete: ${result.installed} installed, ${result.skipped} already current.${failedText}`)
		setManifestSelections(false)
		const modCollect = await window.update_IPC.get()
		await startFromModList(modCollect)
	} else {
		MA.byIdText('manifestStatus', `Collection import failed: ${result.error}`)
		manifestSelectionChanged()
	}
}

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	MA.byIdEventIfExists('selectAllButton', () => { setAllSelections(true) })
	MA.byIdEventIfExists('selectNoneButton', () => { setAllSelections(false) })
	MA.byIdEventIfExists('openSelectedButton', openSelectedSources)
	MA.byIdEventIfExists('downloadSelectedButton', downloadSelectedZIPs)
	MA.byIdEventIfExists('refreshUpdatesButton', refreshUpdateCandidates)
	MA.byIdEventIfExists('historyButton', () => window.update_IPC.dispatchHistory())
	MA.byIdEventIfExists('vaultButton', () => window.update_IPC.dispatchVault())
	MA.byIdEventIfExists('manifestToggleButton', toggleManifestPanel)
	MA.byIdEventIfExists('manifestExportFile', () => exportManifest('file'))
	MA.byIdEventIfExists('manifestCopyLink', () => exportManifest('clipboard'))
	MA.byIdEventIfExists('manifestImportFile', () => importManifest('file'))
	MA.byIdEventIfExists('manifestImportLink', () => importManifest('clipboard'))
	MA.byIdEventIfExists('manifestSelectAll', () => setManifestSelections(true))
	MA.byIdEventIfExists('manifestSelectNone', () => setManifestSelections(false))
	MA.byIdEventIfExists('manifestShowAll', () => applyManifestViewFilter('all'))
	MA.byIdEventIfExists('manifestShowAttention', () => applyManifestViewFilter('attention'))
	MA.byIdEventIfExists('manifestInstall', installManifestSelection)
	MA.byIdEventIfExists('manifestCollection', manifestSelectionChanged, 'change')

	window.update_IPC.receive('mods:list', (modCollect) => {
		startFromModList(modCollect)
	})

})
