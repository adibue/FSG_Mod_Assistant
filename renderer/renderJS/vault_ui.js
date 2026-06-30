/* _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global bootstrap, DATA, MA */

let vaultEntries = []
let vaultCollections = []
let vaultNotes = {}

function uniqueValues(values) {
	return [...new Set(values.filter((value) => typeof value === 'string' && value !== ''))]
}

function formatTimestamp(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return '' }
	return date.toLocaleString()
}

function normalValue(value) {
	return (value ?? '').toString().toLowerCase()
}

function vaultNoteKey(modName) {
	return (modName ?? '').toString().trim().toLocaleLowerCase()
}

function setButtonState(button, disabled, text) {
	button.disabled = disabled
	button.textContent = text
}

function sortTime(entry) {
	const date = new Date(entry.updatedAt ?? entry.createdAt ?? 0)
	if ( Number.isNaN(date.getTime()) ) { return 0 }
	return date.getTime()
}

function sortableVersion(value) {
	return (value ?? '')
		.toString()
		.toLowerCase()
		.replace(/^v/u, '')
		.split(/[^0-9a-z]+/u)
		.filter((part) => part !== '')
		.map((part) => {
			const numberValue = Number.parseInt(part, 10)
			return Number.isNaN(numberValue) ? part : numberValue
		})
}

function compareVersionParts(left, right) {
	const maxLength = Math.max(left.length, right.length)
	for ( let index = 0; index < maxLength; index++ ) {
		const leftPart = left[index] ?? 0
		const rightPart = right[index] ?? 0
		if ( leftPart === rightPart ) { continue }
		if ( typeof leftPart === 'number' && typeof rightPart === 'number' ) {
			return leftPart - rightPart
		}
		return leftPart.toString().localeCompare(rightPart.toString(), undefined, { numeric : true })
	}
	return 0
}

function primaryVersion(entry) {
	const versions = uniqueValues(entry.versions ?? [])
	if ( versions.length === 0 ) { return '' }
	if ( versions.length === 1 ) { return versions[0] }
	if ( Array.isArray(entry.sources) && entry.sources.includes('Collection') ) {
		return versions[0]
	}
	return versions[versions.length - 1]
}

function compareVaultEntries(left, right) {
	const versionCompare = compareVersionParts(sortableVersion(primaryVersion(right)), sortableVersion(primaryVersion(left)))
	if ( versionCompare !== 0 ) { return versionCompare }
	return sortTime(right) - sortTime(left)
}

function badgeTooltip(value, type) {
	switch ( type ) {
		case 'brand' :
			return `Brand or manufacturer found in the mod metadata: ${value}.`
		case 'category' :
			return `Store category found in the mod metadata: ${value}.`
		case 'collection' :
			return `This ZIP is associated with the "${value}" collection.`
		case 'modhub-category' :
			return `Category read from the official ModHub page: ${value}.`
		case 'type' :
			return {
				'Folder mod'      : 'This mod was read from an unpacked folder.',
				'Gameplay script' : 'This mod mainly adds scripts or gameplay behaviour rather than shop items.',
				'Map'             : 'This mod contains map data.',
				'Other'           : 'The vault does not yet have a clearer type for this mod.',
				'Scripted item'   : 'This mod includes shop items and scripts.',
				'Store item'      : 'This mod includes one or more in-game shop items.',
			}[value] ?? `Mod type: ${value}.`
		case 'source' :
			return {
				'Backed up from collection' : 'This ZIP was saved from one of your local mod collections.',
				'Cached GitHub ZIP'        : 'This ZIP was downloaded from GitHub earlier and can be reused without downloading again.',
				'Current rollback copy'    : 'This ZIP is available as a rollback copy for a live mod.',
				'Downloaded from GitHub'   : 'This ZIP came from a GitHub release or repository download.',
				'Rollback action'          : 'This ZIP was involved in restoring an older mod version.',
			}[value] ?? `Source: ${value}.`
		default :
			return value
	}
}

function badgeLabel(value, type) {
	switch ( type ) {
		case 'modhub-category' :
			return `ModHub: ${value}`
		default :
			return value
	}
}

function makeBadges(values, badgeClass, type = '') {
	return values
		.filter((value) => typeof value === 'string' && value !== '')
		.map((value) => {
			const tooltip = DATA.escapeSpecial(badgeTooltip(value, type))
			return `<span class="badge ${badgeClass}" data-bs-placement="top" data-bs-toggle="tooltip" title="${tooltip}">${DATA.escapeSpecial(badgeLabel(value, type))}</span>`
		})
		.join('')
}

function friendlySourceName(source) {
	switch ( source ) {
		case 'Collection' :
			return 'Backed up from collection'
		case 'GitHub' :
			return 'Downloaded from GitHub'
		case 'GitHub cache' :
			return 'Cached GitHub ZIP'
		case 'Rollback' :
			return 'Rollback action'
		case 'Rollback current' :
			return 'Current rollback copy'
		default :
			return source
	}
}

function fragmentToHTML(fragment) {
	const wrapper = document.createElement('div')
	wrapper.appendChild(fragment)
	return wrapper.innerHTML
}

function modIconHTML(icon) {
	const iconSource = DATA.escapeSpecial(DATA.iconMaker(icon))
	return `<img alt="" class="vault-mod-logo" src="${iconSource}">`
}

function fillCollectionSelect(select) {
	select.innerHTML = ''
	const placeholder = document.createElement('option')
	placeholder.value = ''
	placeholder.textContent = vaultCollections.length === 0 ? 'No collections found' : 'Choose collection...'
	select.appendChild(placeholder)

	for ( const collection of vaultCollections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}
}

function enableTooltips(parent) {
	for ( const element of parent.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		new bootstrap.Tooltip(element)
	}
}

function groupEntries(entries) {
	const groups = new Map()

	for ( const entry of entries ) {
		const modName = entry.modNames?.[0] ?? entry.fileName ?? '-- unknown mod --'
		const groupKey = modName.toLowerCase()
		if ( !groups.has(groupKey) ) {
			groups.set(groupKey, {
				entries  : [],
				modName,
				searches : [],
			})
		}
		groups.get(groupKey).entries.push(entry)
	}

	return [...groups.values()].map((group) => {
		const sortedEntries = group.entries.toSorted(compareVaultEntries)
		const modIcon = sortedEntries.find((entry) => typeof entry.modIcon === 'string' && entry.modIcon !== '')?.modIcon ?? null
		const versions = uniqueValues(group.entries.flatMap((entry) => entry.versions ?? []))
		const collections = uniqueValues(group.entries.flatMap((entry) => entry.collections ?? []))
		const categories = uniqueValues(group.entries.flatMap((entry) => entry.itemCategories ?? []))
		const brands = uniqueValues(group.entries.flatMap((entry) => entry.itemBrands ?? []))
		const modHubCategories = uniqueValues(group.entries.flatMap((entry) => entry.modHubCategories ?? []))
		const modTypes = uniqueValues(group.entries.flatMap((entry) => entry.modTypes ?? []))
		const sources = uniqueValues(group.entries.flatMap((entry) => entry.sources ?? []).map((source) => friendlySourceName(source)))
		const note = vaultNotes[vaultNoteKey(group.modName)]?.note ?? ''
		const searchText = normalValue([
			group.modName,
			note,
			versions.join(' '),
			collections.join(' '),
			categories.join(' '),
			brands.join(' '),
			modHubCategories.join(' '),
			modTypes.join(' '),
			sources.join(' '),
			group.entries.map((entry) => entry.fileName).join(' '),
			group.entries.map((entry) => entry.sourceURL).join(' '),
			group.entries.map((entry) => entry.hash).join(' '),
		].join(' '))
		return {
			...group,
			brands,
			categories,
			collections,
			entries : sortedEntries,
			modHubCategories,
			modIcon,
			modTypes,
			note,
			searchText,
			sources,
			totalSize : group.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
			versions,
		}
	}).sort((a, b) => a.modName.localeCompare(b.modName))
}

function filterEntries() {
	const textFilter = normalValue(MA.byId('vaultTextFilter').value)
	const typeFilter = MA.byId('vaultTypeFilter').value
	const categoryFilter = MA.byId('vaultCategoryFilter').value
	const modHubCategoryFilter = MA.byId('vaultModHubCategoryFilter').value
	const groups = groupEntries(vaultEntries)
	return groups.filter((group) =>
		(textFilter === '' || group.searchText.includes(textFilter)) &&
		(typeFilter === '' || group.modTypes.includes(typeFilter)) &&
		(categoryFilter === '' || group.categories.includes(categoryFilter)) &&
		(modHubCategoryFilter === '' || group.modHubCategories.includes(modHubCategoryFilter))
	)
}

function versionLabel(entry) {
	const version = primaryVersion(entry)
	if ( version === '' ) { return 'Version unknown' }
	return `Version ${version}`
}

async function renderFileRows(entries, groupIndex) {
	// eslint-disable-next-line complexity
	const rows = await Promise.all(entries.map(async (entry, entryIndex) => {
		const size = await DATA.bytesToHR(entry.size ?? 0)
		const detailsId = `vaultDetails_${groupIndex}_${entryIndex}`
		const row = DATA.templateEngine('vault_file_row', {
			brandBadges      : makeBadges(entry.itemBrands ?? [], 'text-bg-dark', 'brand'),
			categoryBadges   : makeBadges(entry.itemCategories ?? [], 'text-bg-info', 'category'),
			collectionBadges : makeBadges(entry.collections ?? [], 'text-bg-secondary', 'collection'),
			fileName         : DATA.escapeSpecial(entry.fileName ?? ''),
			filePath         : DATA.escapeSpecial(entry.filePath ?? ''),
			gameVersions     : DATA.escapeSpecial((entry.gameVersions ?? []).join(', ') || 'unknown'),
			hash             : DATA.escapeSpecial(entry.hash ?? ''),
			missingBadge     : entry.fileExists ? '' : '<span class="badge text-bg-danger ms-1" data-bs-placement="top" data-bs-toggle="tooltip" title="The vault record exists, but the ZIP file could not be found on disk.">missing file</span>',
			modHubCategories : DATA.escapeSpecial((entry.modHubCategories ?? []).join(', ') || 'none'),
			modHubCategoryBadges : makeBadges(entry.modHubCategories ?? [], 'text-bg-success', 'modhub-category'),
			modHubIDs        : DATA.escapeSpecial((entry.modHubIDs ?? []).join(', ') || 'none'),
			modHubVersions   : DATA.escapeSpecial((entry.modHubVersions ?? []).join(', ') || 'none'),
			size             : DATA.escapeSpecial(size),
			sourceBadges     : makeBadges(uniqueValues(entry.sources ?? []).map((source) => friendlySourceName(source)), 'text-bg-warning', 'source'),
			typeBadges       : makeBadges(entry.modTypes ?? [], 'text-bg-primary', 'type'),
			updatedAt        : DATA.escapeSpecial(formatTimestamp(entry.updatedAt)),
			usedBadge        : entry.isUsed ?
				'<span class="badge text-bg-success" data-bs-placement="top" data-bs-toggle="tooltip" title="At least one collection history entry still points to this ZIP.">referenced by history</span>' :
				'<span class="badge text-bg-secondary" data-bs-placement="top" data-bs-toggle="tooltip" title="This ZIP is stored in the vault, but the current collection history does not point to it.">not referenced by history</span>',
			versionLabel      : DATA.escapeSpecial(versionLabel(entry)),
			versionLabels     : DATA.escapeSpecial(uniqueValues(entry.versions ?? []).join(', ') || 'unknown'),
		})
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-toggle', 'collapse')
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-target', `#${detailsId}`)
		row.querySelector('.vault-technical-details').id = detailsId
		row.querySelector('.vault-copy-button').dataset.hash = entry.hash ?? ''
		fillCollectionSelect(row.querySelector('.vault-copy-target'))
		return fragmentToHTML(row)
	}))

	return rows.join('')
}

function fillSelect(selectID, values, firstLabel) {
	const select = MA.byId(selectID)
	const currentValue = select.value
	select.innerHTML = `<option value="">${DATA.escapeSpecial(firstLabel)}</option>`
	for ( const value of values.toSorted((a, b) => a.localeCompare(b)) ) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = value
		select.appendChild(option)
	}
	if ( values.includes(currentValue) ) {
		select.value = currentValue
	}
}

function refreshFilterOptions() {
	fillSelect('vaultTypeFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.modTypes ?? [])), 'All mod types')
	fillSelect('vaultCategoryFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.itemCategories ?? [])), 'All internal categories')
	fillSelect('vaultModHubCategoryFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.modHubCategories ?? [])), 'All ModHub categories')
}

async function renderVault(groups) {
	const list = MA.byId('vaultList')
	list.innerHTML = ''

	if ( groups.length === 0 ) {
		MA.byIdText('vaultStatus', vaultEntries.length === 0 ? 'No mod vault entries found.' : 'No matching vault entries found.')
		return
	}

	MA.byIdText(
		'vaultStatus',
		`${groups.length} mod${groups.length === 1 ? '' : 's'} shown, containing ${vaultEntries.length} stored ZIP file${vaultEntries.length === 1 ? '' : 's'}.`
	)

	const nodes = await Promise.all(groups.map(async (group, groupIndex) => {
		const totalSize = await DATA.bytesToHR(group.totalSize)
		const groupBodyId = `vaultGroup_${groupIndex}`
		const noteBodyId = `vaultNote_${groupIndex}`
		const versionText = group.versions.length === 0 ?
			'No version metadata recorded' :
			`${group.versions.length} version label${group.versions.length === 1 ? '' : 's'} recorded`
		const node = DATA.templateEngine('vault_line', {
			fileCount      : DATA.escapeSpecial(`${group.entries.length} stored ZIP file${group.entries.length === 1 ? '' : 's'}`),
			fileRows       : await renderFileRows(group.entries, groupIndex),
			modIcon        : modIconHTML(group.modIcon),
			modName        : DATA.escapeSpecial(group.modName),
			totalSize      : DATA.escapeSpecial(totalSize),
			versionSummary : DATA.escapeSpecial(versionText),
		})
		node.querySelector('.vault-group-toggle').setAttribute('data-bs-toggle', 'collapse')
		node.querySelector('.vault-group-toggle').setAttribute('data-bs-target', `#${groupBodyId}`)
		node.querySelector('.vault-group-body').id = groupBodyId
		const noteToggle = node.querySelector('.vault-note-toggle')
		const notePanel = node.querySelector('.vault-note-panel')
		const noteInput = node.querySelector('.vault-note-input')
		const notePreview = node.querySelector('.vault-note-preview')
		const noteBadge = node.querySelector('.vault-note-badge')
		noteToggle.setAttribute('data-bs-toggle', 'collapse')
		noteToggle.setAttribute('data-bs-target', `#${noteBodyId}`)
		noteToggle.textContent = group.note === '' ? 'Add note' : 'Edit note'
		notePanel.id = noteBodyId
		noteInput.value = group.note
		notePreview.textContent = group.note
		for ( const button of node.querySelectorAll('.vault-note-save, .vault-note-clear') ) {
			button.dataset.modName = group.modName
		}
		if ( group.note !== '' ) {
			noteBadge.classList.remove('d-none')
			notePreview.classList.remove('d-none')
		} else {
			node.querySelector('.vault-note-clear').disabled = true
		}
		return node
	}))

	for ( const node of nodes ) {
		list.appendChild(node)
	}
	enableTooltips(list)
}

async function loadVault() {
	const [vault, collections] = await Promise.all([
		window.vault_IPC.all(),
		window.vault_IPC.collections(),
	])
	vaultEntries = vault.entries
	vaultCollections = collections
	vaultNotes = vault.notes ?? {}
	MA.byIdText('vaultCount', vault.totalCount.toString())
	MA.byIdText('vaultUsedCount', vault.usedCount.toString())
	MA.byIdText('vaultSize', await DATA.bytesToHR(vault.totalSize))
	MA.byIdText('vaultFolder', vault.folder)
	refreshFilterOptions()
	await renderVault(filterEntries())
}

// eslint-disable-next-line complexity
async function saveVaultNote(button, shouldClear = false) {
	const group = button.closest('.vault-group-row')
	const input = group?.querySelector('.vault-note-input')
	const modName = button.dataset.modName ?? ''
	if ( group === null || input === null || modName === '' ) { return }

	if ( shouldClear && input.value.trim() !== '' && !confirm(`Clear the note for ${modName}?`) ) { return }

	const note = shouldClear ? '' : input.value
	const originalText = button.textContent
	setButtonState(button, true, shouldClear ? 'Clearing...' : 'Saving...')

	try {
		const result = await window.vault_IPC.saveNote({ modName, note })
		if ( !result.ok ) {
			group.querySelector('.vault-note-status').textContent = `Note could not be saved: ${result.error ?? 'Unknown error'}`
			return
		}

		if ( result.record === null ) {
			delete vaultNotes[result.key]
		} else {
			vaultNotes[result.key] = result.record
		}

		const savedNote = result.record?.note ?? ''
		const preview = group.querySelector('.vault-note-preview')
		const badge = group.querySelector('.vault-note-badge')
		const toggle = group.querySelector('.vault-note-toggle')
		const clearButton = group.querySelector('.vault-note-clear')
		input.value = savedNote
		preview.textContent = savedNote
		preview.classList.toggle('d-none', savedNote === '')
		badge.classList.toggle('d-none', savedNote === '')
		toggle.textContent = savedNote === '' ? 'Add note' : 'Edit note'
		clearButton.disabled = savedNote === ''
		group.querySelector('.vault-note-status').textContent = savedNote === '' ? 'Note cleared.' : 'Note saved.'
		MA.byIdText('vaultStatus', savedNote === '' ? `Cleared the note for ${modName}.` : `Saved the note for ${modName}.`)
	} catch (err) {
		group.querySelector('.vault-note-status').textContent = `Note could not be saved: ${err.message}`
	} finally {
		setButtonState(button, shouldClear && input.value.trim() === '', originalText)
	}
}

async function copyVaultEntry(button) {
	const row = button.closest('.vault-file-row')
	const select = row?.querySelector('.vault-copy-target')
	const rowStatus = row?.querySelector('.vault-copy-result')
	const collectionKey = select?.value ?? ''
	if ( collectionKey === '' ) {
		const message = 'Choose a collection before copying from the vault.'
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) { rowStatus.textContent = message }
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Copying...')
	if ( rowStatus !== null ) { rowStatus.textContent = 'Copying ZIP to the selected collection...' }
	const hash = button.dataset.hash

	try {
		let result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : false })
		if ( result.needsOverwrite ) {
			const confirmed = confirm(`${result.fileName} already exists in ${result.collectionName}. Replace it and save a backup first?`)
			if ( !confirmed ) {
				const message = 'Copy cancelled. Nothing was changed.'
				MA.byIdText('vaultStatus', message)
				if ( rowStatus !== null ) { rowStatus.textContent = message }
				return
			}
			result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : true })
		}

		if ( !result.ok ) {
			const message = `Vault copy failed: ${result.error ?? 'Unknown error'}`
			MA.byIdText('vaultStatus', message)
			if ( rowStatus !== null ) { rowStatus.textContent = message }
			return
		}

		const backupText = result.replacedExisting ? ' Existing copy was backed up first.' : ''
		const message = `Copied ${result.fileName} to ${result.collectionName}.${backupText}`
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) {
			rowStatus.classList.add('text-success')
			rowStatus.textContent = message
		}
	} catch (err) {
		const message = `Vault copy failed: ${err.message}`
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) { rowStatus.textContent = message }
	} finally {
		setButtonState(button, false, originalText)
	}
}

async function importCollections() {
	const button = MA.byId('vaultImportCollections')
	button.disabled = true
	const originalText = button.textContent
	button.textContent = 'Scanning collections...'
	MA.byIdText('vaultStatus', 'Scanning collections and adding unique ZIPs to the vault...')
	try {
		const result = await window.vault_IPC.importCollections()
		vaultEntries = result.summary.entries
		vaultCollections = await window.vault_IPC.collections()
		MA.byIdText('vaultCount', result.summary.totalCount.toString())
		MA.byIdText('vaultUsedCount', result.summary.usedCount.toString())
		MA.byIdText('vaultSize', await DATA.bytesToHR(result.summary.totalSize))
		MA.byIdText('vaultFolder', result.summary.folder)
		refreshFilterOptions()
		await renderVault(filterEntries())
		const errorText = result.errors.length === 0 ? '' : ` ${result.errors.length} item${result.errors.length === 1 ? '' : 's'} could not be added.`
		MA.byIdText('vaultStatus', `Scanned ${result.scanned} collection mod${result.scanned === 1 ? '' : 's'} and updated ${result.imported} vault record${result.imported === 1 ? '' : 's'}.${errorText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault scan failed: ${err.message}`)
	} finally {
		button.disabled = false
		button.textContent = originalText
	}
}

async function refreshModHubCategories() {
	const button = MA.byId('vaultRefreshModHub')
	button.disabled = true
	const originalText = button.textContent
	button.textContent = 'Refreshing ModHub...'
	MA.byIdText('vaultStatus', 'Reading ModHub category data for vaulted mods. This may take a little while...')
	try {
		const result = await window.vault_IPC.refreshModHub()
		vaultEntries = result.summary.entries
		MA.byIdText('vaultCount', result.summary.totalCount.toString())
		MA.byIdText('vaultUsedCount', result.summary.usedCount.toString())
		MA.byIdText('vaultSize', await DATA.bytesToHR(result.summary.totalSize))
		MA.byIdText('vaultFolder', result.summary.folder)
		refreshFilterOptions()
		await renderVault(filterEntries())
		const errorText = result.errors.length === 0 ? '' : ` ${result.errors.length} ModHub page${result.errors.length === 1 ? '' : 's'} could not be read.`
		const emptyText = result.scanned === 0 ? ' No ModHub IDs were found in the vault yet; scan collections into the vault first, then refresh ModHub categories.' : ''
		MA.byIdText('vaultStatus', `Checked ${result.scanned} ModHub-linked vault record${result.scanned === 1 ? '' : 's'} and refreshed ${result.refreshed} categor${result.refreshed === 1 ? 'y' : 'ies'}.${errorText}${emptyText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `ModHub category refresh failed: ${err.message}`)
	} finally {
		button.disabled = false
		button.textContent = originalText
	}
}

window.addEventListener('DOMContentLoaded', () => {
	MA.byId('vaultList').addEventListener('contextmenu', window.vault_IPC.context)
	MA.byId('vaultList').addEventListener('click', (event) => {
		const copyButton = event.target.closest('.vault-copy-button')
		if ( copyButton !== null ) { copyVaultEntry(copyButton) }
		const saveNoteButton = event.target.closest('.vault-note-save')
		if ( saveNoteButton !== null ) { saveVaultNote(saveNoteButton) }
		const clearNoteButton = event.target.closest('.vault-note-clear')
		if ( clearNoteButton !== null ) { saveVaultNote(clearNoteButton, true) }
	})
	MA.byId('vaultTextFilter').addEventListener('input', () => { renderVault(filterEntries()) })
	MA.byId('vaultTypeFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultCategoryFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultModHubCategoryFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultClearFilters').addEventListener('click', () => {
		MA.byId('vaultTextFilter').value = ''
		MA.byId('vaultTypeFilter').value = ''
		MA.byId('vaultCategoryFilter').value = ''
		MA.byId('vaultModHubCategoryFilter').value = ''
		renderVault(filterEntries())
	})
	MA.byId('vaultImportCollections').addEventListener('click', importCollections)
	MA.byId('vaultRefreshModHub').addEventListener('click', refreshModHubCategories)
	MA.byId('vaultOpenFolder').addEventListener('click', () => { window.vault_IPC.openFolder() })
	MA.byId('vaultBackToUpdates').addEventListener('click', () => { window.vault_IPC.dispatchUpdate() })
	loadVault()
})
