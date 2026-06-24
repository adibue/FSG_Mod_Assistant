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
			if ( !isGitHubURL(sourceURL) ) { continue }

			candidates[modName] ??= {
				collections : [],
				icon        : thisMod.modDesc.iconImage,
				local       : new Set(),
				sourceURL   : sourceURL,
				title       : doL10N(thisMod.l10n.title, modCollect.appSettings.force_lang),
			}

			candidates[modName].collections.push(collectKeyName[collectKey])
			candidates[modName].local.add(thisMod.modDesc.version)
		}
	}

	return candidates
}

function isUpdateAvailable(localVersions, remoteVersion) {
	for ( const localVersion of localVersions ) {
		const compare = DATA.versionCompare(localVersion, remoteVersion)
		if ( compare < 0 || (Number.isNaN(compare) && DATA.versionDifferent(localVersion, remoteVersion)) ) {
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

function modListTimeout(timeoutMS = 15000) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve(null)
		}, timeoutMS)
	})
}

let activeRenderID = 0

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
	const selectedCount = getUpdateCheckboxes().filter((checkbox) => checkbox.checked).length
	MA.byIdHTML('selectedCount', `${I18N.defer('update_list_selected', false)} ${selectedCount}`)
}

function setAllSelections(isChecked) {
	for ( const checkbox of getUpdateCheckboxes() ) {
		checkbox.checked = isChecked
	}
	updateSelectedCount()
}

async function displayCandidates(candidates, renderID) {
	const listDiv = MA.byId('modList')
	const candidateEntries = Object.entries(candidates).sort((a, b) => Intl.Collator().compare(a[0], b[0]))
	let completeCount = 0

	listDiv.innerHTML = ''

	if ( candidateEntries.length === 0 ) {
		renderEmpty('update_list_no_sources')
		return
	}

	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} 0 / ${candidateEntries.length}`)

	const checkPromises = candidateEntries.map(async ([key, entry]) => {
		const result = await withTimeout(window.update_IPC.getGitHub(entry.sourceURL))
		completeCount++
		if ( renderID === activeRenderID ) {
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${completeCount} / ${candidateEntries.length}`)
		}

		if ( !result.ok ) { return null }
		if ( !isUpdateAvailable(entry.local, result.version) ) { return null }
	
		const collectionList = entry.collections
			.sort((a, b) => Intl.Collator().compare(a, b))
			.map((collection) => `<li><span class="fw-bold">${DATA.escapeSpecial(collection)}</span></li>`)

		return {
			node      : DATA.templateEngine('update_line', {
				collections   : collectionList.join(''),
				githubVersion : DATA.escapeSpecial(result.version),
				iconImage     : `<img class="img-fluid" src="${DATA.iconMaker(entry.icon)}" />`,
				localVersion  : DATA.escapeSpecial([...entry.local].sort().join(', ')),
				realName      : entry.title,
				shortName     : DATA.escapeSpecial(key),
				statusText    : statusText(result),
			}),
			sourceURL : entry.sourceURL,
		}
	})

	const updateRows = (await Promise.all(checkPromises)).filter((x) => x !== null)

	if ( renderID !== activeRenderID ) { return }

	for ( const { node, sourceURL } of updateRows ) {
		node.firstElementChild.classList.add('bg-warning-subtle')
		node.querySelector('.update-select-checkbox').addEventListener('change', updateSelectedCount)
		const sourceButton = node.querySelector('.update-source-button')
		sourceButton.dataset.sourceUrl = sourceURL
		sourceButton.addEventListener('click', (event) => {
			const buttonURL = event.currentTarget.dataset.sourceUrl
			if ( isGitHubURL(buttonURL) ) {
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

async function startFromModList(modCollect) {
	const renderID = ++activeRenderID

	if ( modCollect === null ) {
		renderEmpty('update_list_load_failed')
		return
	}
	try {
		MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
		MA.byIdHTML('modList', '')
		MA.byId('selectionControls').classList.add('d-none')
		updateSelectedCount()
		await displayCandidates(makeCandidateMap(modCollect), renderID)
	} catch (err) {
		MA.byIdText('updateStatus', `Update list error: ${err.message}`)
	}
}

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	MA.byIdEventIfExists('selectAllButton', () => { setAllSelections(true) })
	MA.byIdEventIfExists('selectNoneButton', () => { setAllSelections(false) })

	window.update_IPC.receive('mods:list', (modCollect) => {
		startFromModList(modCollect)
	})

	Promise.race([window.update_IPC.get(), modListTimeout()]).then((modCollect) => {
		if ( activeRenderID !== 0 ) { return }
		startFromModList(modCollect)
	})
})
