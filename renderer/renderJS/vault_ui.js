/* _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global bootstrap, client_BGData, DATA, MA */

let vaultEntries = []
let vaultCollections = []
let vaultCleanup = { count : 0, entries : [], totalSize : 0 }
let vaultNotes = {}
let vaultSourceFilter = ''
let vaultSelectedHashes = new Set()

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

function focusVaultSearch() {
	requestAnimationFrame(() => {
		const search = MA.byId('vaultTextFilter')
		window.focus()
		search.focus({ preventScroll : true })
		search.setSelectionRange(search.value.length, search.value.length)
	})
}

function visibleVaultGroups() {
	return [...MA.byId('vaultList').querySelectorAll('.vault-group-body.show')]
		.map((body) => body.closest('.vault-group-row')?.dataset.modName ?? '')
		.filter((modName) => modName !== '')
}

function captureVaultViewState() {
	return {
		openGroups : visibleVaultGroups(),
		scrollX    : window.scrollX,
		scrollY    : window.scrollY,
	}
}

function restoreVaultViewState(state = {}) {
	const openGroups = new Set(state.openGroups ?? [])
	for ( const row of MA.byId('vaultList').querySelectorAll('.vault-group-row') ) {
		if ( !openGroups.has(row.dataset.modName ?? '') ) { continue }
		const body = row.querySelector('.vault-group-body')
		const toggle = row.querySelector('.vault-group-toggle')
		if ( body !== null ) { body.classList.add('show') }
		if ( toggle !== null ) { toggle.setAttribute('aria-expanded', 'true') }
	}
	window.scrollTo(state.scrollX ?? window.scrollX, state.scrollY ?? window.scrollY)
}

function cleanListText(values, fallback = 'none') {
	const cleanValues = uniqueValues(values ?? [])
	return cleanValues.length === 0 ? fallback : cleanValues.join(', ')
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

function modHubStatusDisplay(entry) {
	const latestVersion = entry.modHubLatestVersion
	const safeVersion = typeof latestVersion === 'string' && latestVersion !== '' ? DATA.escapeSpecial(latestVersion) : 'version unknown'
	const safeURL = typeof entry.modHubURL === 'string' ? DATA.escapeSpecial(entry.modHubURL) : null
	const versionDisplay = safeURL === null ? safeVersion : `<a href="${safeURL}" target="_BLANK">${safeVersion}</a>`

	switch ( entry.modHubStatus ) {
		case 'update-available' :
			return {
				badge : '<span class="badge text-bg-warning" title="The official ModHub catalogue has a newer version.">ModHub update</span>',
				line  : `Official ModHub version ${versionDisplay} is newer than this stored ZIP.`,
			}
		case 'current' :
			return {
				badge : '<span class="badge text-bg-success" title="This stored ZIP matches the current ModHub version.">ModHub current</span>',
				line  : `Matches official ModHub version ${versionDisplay}.`,
			}
		case 'local-newer' :
			return {
				badge : '<span class="badge text-bg-info" title="The local ZIP has a higher version than the ModHub catalogue.">Local newer</span>',
				line  : `Local version is newer than official ModHub version ${versionDisplay}.`,
			}
		case 'comparison-unknown' :
		case 'version-unknown' :
			return {
				badge : '<span class="badge text-bg-secondary" title="A ModHub match was found, but its version could not be compared safely.">ModHub matched</span>',
				line  : `Matched to ModHub (${versionDisplay}); update status is unknown.`,
			}
		default :
			return {
				badge : '',
				line  : '<span class="text-body-secondary">No reliable ModHub filename match.</span>',
			}
	}
}

function retentionBadgeDisplay(entry) {
	const status = entry.retentionStatus ?? (entry.isUsed ? 'protected' : (entry.fileExists ? 'cleanable' : 'record-only'))
	const label = entry.retentionLabel ?? {
		cleanable   : 'Cleanable',
		protected   : 'Protected',
		'record-only' : 'Record only',
	}[status] ?? 'Vault ZIP'
	const reason = entry.retentionReason ?? 'No retention reason was recorded for this Vault ZIP.'
	const badgeClass = {
		cleanable   : 'text-bg-danger',
		protected   : 'text-bg-success',
		'record-only' : 'text-bg-secondary',
	}[status] ?? 'text-bg-secondary'

	return `<span class="badge ${badgeClass}" data-bs-placement="top" data-bs-toggle="tooltip" title="${DATA.escapeSpecial(reason)}">${DATA.escapeSpecial(label)}</span>`
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

function hasGitHubSource(entry) {
	try {
		if ( new URL(entry.sourceURL).hostname.toLowerCase() === 'github.com' ) { return true }
	} catch { /* A missing or non-web source is not a GitHub source. */ }
	return (entry.sources ?? []).some((source) => source === 'GitHub' || source === 'GitHub cache')
}

function sourceTypesForEntries(entries) {
	const sourceTypes = new Set()
	for ( const entry of entries ) {
		const isModHub = entry.modHubStatus !== 'unmatched' || (entry.modHubIDs ?? []).length !== 0
		const isGitHub = hasGitHubSource(entry)
		if ( isModHub ) { sourceTypes.add('modhub') }
		if ( isGitHub ) { sourceTypes.add('github') }
		if ( !isModHub && !isGitHub ) { sourceTypes.add('manual') }
	}
	return [...sourceTypes]
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

function storePreviewIconSource(icon) {
	if ( typeof icon !== 'string' || icon === '' ) { return DATA.iconMaker(icon) }
	if ( icon.startsWith('data:') ) { return icon.replace(/^(data:[^,]+,)\s*/u, '$1') }
	if ( icon.startsWith('$data') ) {
		const iconPointer = icon.replace('.png', '.dds')
		const trueIcon = client_BGData?.icons?.[iconPointer]
		if ( typeof trueIcon === 'string' ) { return trueIcon }
	}
	const compactIcon = icon.replaceAll(/\s/gu, '')
	if ( compactIcon.length > 100 && /^[A-Za-z0-9+/]+=*$/u.test(compactIcon) ) {
		return `data:image/png;base64,${compactIcon}`
	}
	return DATA.iconMaker(icon)
}

function storeItemPreviewHTML(previews, maxItems = 6) {
	if ( !Array.isArray(previews) || previews.length === 0 ) { return '' }

	const imageHTML = previews.slice(0, maxItems).map((preview) => {
		const iconSource = DATA.escapeSpecial(storePreviewIconSource(preview.icon))
		const title = DATA.escapeSpecial(preview.name || 'Store item')
		return `<img alt="" data-bs-placement="top" data-bs-toggle="tooltip" src="${iconSource}" title="${title}">`
	})
	const remaining = previews.length - maxItems
	if ( remaining > 0 ) {
		imageHTML.push(`<span class="vault-store-preview-more">+${remaining}</span>`)
	}

	return `<div class="vault-store-preview mt-2">${imageHTML.join('')}</div>`
}

function mergeStoreItemPreviews(entries, limit = 8) {
	const previews = []
	const seenImages = new Set()
	for ( const preview of entries.flatMap((entry) => entry.storeItemPreviews ?? [])) {
		if ( typeof preview?.icon !== 'string' || preview.icon === '' || seenImages.has(preview.icon) ) { continue }
		seenImages.add(preview.icon)
		previews.push(preview)
		if ( previews.length >= limit ) { break }
	}
	return previews
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

function updateVaultSelectionControls() {
	const selectedCount = vaultSelectedHashes.size
	const bulkTarget = MA.byId('vaultBulkCopyTarget')
	const bulkButton = MA.byId('vaultBulkCopyButton')
	MA.byIdText('vaultSelectedCount', `Selected Vault ZIPs: ${selectedCount}`)
	bulkButton.disabled = selectedCount === 0 || bulkTarget.value === ''
}

function refreshBulkCopyTarget() {
	const select = MA.byId('vaultBulkCopyTarget')
	const previousValue = select.value
	fillCollectionSelect(select)
	if ( vaultCollections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
	updateVaultSelectionControls()
}

function pruneVaultSelection() {
	const validHashes = new Set(vaultEntries.map((entry) => entry.hash).filter((hash) => typeof hash === 'string' && hash !== ''))
	vaultSelectedHashes = new Set([...vaultSelectedHashes].filter((hash) => validHashes.has(hash)))
	updateVaultSelectionControls()
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
		const sourceTypes = sourceTypesForEntries(group.entries)
		const storeItemPreviews = mergeStoreItemPreviews(sortedEntries)
		const note = vaultNotes[vaultNoteKey(group.modName)]?.note ?? ''
		const hasNote = note.trim() !== ''
		const hasRollback = group.entries.some((entry) => entry.isUsed === true || (entry.sources ?? []).some((source) => source === 'Rollback' || source === 'Rollback current'))
		const hasUpdate = group.entries.some((entry) => entry.modHubStatus === 'update-available')
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
			group.entries.map((entry) => `${entry.modHubLatestVersion ?? ''} ${entry.modHubStatus ?? ''}`).join(' '),
			group.entries.map((entry) => (entry.storeItemPreviews ?? []).map((preview) => preview.name).join(' ')).join(' '),
			group.entries.map((entry) => entry.hash).join(' '),
		].join(' '))
		return {
			...group,
			brands,
			categories,
			collections,
			entries : sortedEntries,
			hasNote,
			hasRollback,
			hasUpdate,
			modHubCategories,
			modIcon,
			modTypes,
			note,
			searchText,
			sources,
			sourceTypes,
			storeItemPreviews,
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
	const collectionFilter = MA.byId('vaultCollectionFilter').value
	const noteFilter = MA.byId('vaultNoteFilter').value
	const rollbackFilter = MA.byId('vaultRollbackFilter').value
	const updateFilter = MA.byId('vaultUpdateFilter').value
	const groups = groupEntries(vaultEntries)
	// Each independent Vault filter contributes one simple predicate branch.
	// eslint-disable-next-line complexity
	return groups.filter((group) =>
		(textFilter === '' || group.searchText.includes(textFilter)) &&
		(typeFilter === '' || group.modTypes.includes(typeFilter)) &&
		(categoryFilter === '' || group.categories.includes(categoryFilter)) &&
		(modHubCategoryFilter === '' || group.modHubCategories.includes(modHubCategoryFilter)) &&
		(collectionFilter === '' || group.collections.includes(collectionFilter)) &&
		(vaultSourceFilter === '' || group.sourceTypes.includes(vaultSourceFilter)) &&
		(noteFilter === '' || (noteFilter === 'with' && group.hasNote) || (noteFilter === 'without' && !group.hasNote)) &&
		(rollbackFilter === '' || (rollbackFilter === 'with' && group.hasRollback) || (rollbackFilter === 'without' && !group.hasRollback)) &&
		(updateFilter === '' || (updateFilter === 'available' && group.hasUpdate) || (updateFilter === 'none' && !group.hasUpdate))
	)
}

function setSourceFilter(sourceType) {
	vaultSourceFilter = sourceType
	for ( const button of MA.byId('vaultSourceFilter').querySelectorAll('button[data-source]') ) {
		const isActive = button.dataset.source === sourceType
		button.classList.toggle('active', isActive)
		button.setAttribute('aria-pressed', isActive.toString())
	}
	renderVault(filterEntries())
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
		const modHubDisplay = modHubStatusDisplay(entry)
		const canDelete = entry.fileExists === true && entry.retentionStatus === 'cleanable'
		const row = DATA.templateEngine('vault_file_row', {
			brandBadges      : makeBadges(entry.itemBrands ?? [], 'text-bg-dark', 'brand'),
			categoryBadges   : makeBadges(entry.itemCategories ?? [], 'text-bg-info', 'category'),
			collectionBadges : makeBadges(entry.collections ?? [], 'text-bg-secondary', 'collection'),
			deleteButton     : canDelete ? '<button class="btn btn-sm btn-outline-danger vault-delete-request" title="Permanently delete this cleanable ZIP from the Vault." type="button">Delete ZIP</button>' : '',
			deleteConfirmation : canDelete ? '<div class="alert alert-danger d-none mt-2 mb-0 vault-delete-confirmation"><div class="small mb-2">Permanently delete this ZIP from the Vault? This action is logged and cannot be undone.</div><div class="d-flex flex-wrap gap-2"><button class="btn btn-sm btn-danger vault-delete-confirm" type="button">Delete permanently</button><button class="btn btn-sm btn-outline-secondary vault-delete-cancel" type="button">Cancel</button></div></div>' : '',
			fileName         : DATA.escapeSpecial(entry.fileName ?? ''),
			filePath         : DATA.escapeSpecial(entry.filePath ?? ''),
			gameVersions     : DATA.escapeSpecial((entry.gameVersions ?? []).join(', ') || 'unknown'),
			hash             : DATA.escapeSpecial(entry.hash ?? ''),
			missingBadge     : entry.fileExists ? '' : '<span class="badge text-bg-danger ms-1" data-bs-placement="top" data-bs-toggle="tooltip" title="The vault record exists, but the ZIP file could not be found on disk.">missing file</span>',
			modHubCategories : DATA.escapeSpecial((entry.modHubCategories ?? []).join(', ') || 'none'),
			modHubCategoryBadges : makeBadges(entry.modHubCategories ?? [], 'text-bg-success', 'modhub-category'),
			modHubIDs        : DATA.escapeSpecial((entry.modHubIDs ?? []).join(', ') || 'none'),
			modHubMatch      : DATA.escapeSpecial(`${entry.modHubMatchMethod ?? 'unmatched'} (${entry.modHubMatchConfidence ?? 'none'} confidence)`),
			modHubStatusBadge : modHubDisplay.badge,
			modHubStatusLine : modHubDisplay.line,
			modHubVersions   : DATA.escapeSpecial((entry.modHubVersions ?? []).join(', ') || 'none'),
			retentionBadge   : retentionBadgeDisplay(entry),
			retentionReason  : DATA.escapeSpecial(entry.retentionReason ?? ''),
			size             : DATA.escapeSpecial(size),
			sourceBadges     : makeBadges(uniqueValues(entry.sources ?? []).map((source) => friendlySourceName(source)), 'text-bg-warning', 'source'),
			storeItemPreviews : storeItemPreviewHTML(entry.storeItemPreviews ?? [], 8),
			typeBadges       : makeBadges(entry.modTypes ?? [], 'text-bg-primary', 'type'),
			updatedAt        : DATA.escapeSpecial(formatTimestamp(entry.updatedAt)),
			usedBadge        : entry.isUsed ?
				'<span class="badge text-bg-success" data-bs-placement="top" data-bs-toggle="tooltip" title="At least one collection history entry still points to this ZIP.">referenced by history</span>' :
				'<span class="badge text-bg-secondary" data-bs-placement="top" data-bs-toggle="tooltip" title="This ZIP is stored in the vault, but the current collection history does not point to it.">not referenced by history</span>',
			versionLabel      : DATA.escapeSpecial(versionLabel(entry)),
			versionLabels     : DATA.escapeSpecial(uniqueValues(entry.versions ?? []).join(', ') || 'unknown'),
		})
		const rowNode = row.querySelector('.vault-file-row')
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-toggle', 'collapse')
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-target', `#${detailsId}`)
		row.querySelector('.vault-technical-details').id = detailsId
		row.querySelector('.vault-copy-button').dataset.hash = entry.hash ?? ''
		const keepButton = row.querySelector('.vault-keep-button')
		keepButton.dataset.hash = entry.hash ?? ''
		keepButton.dataset.keepPinned = entry.keepPinned ? 'false' : 'true'
		keepButton.textContent = entry.keepPinned ? 'Unkeep ZIP' : 'Keep ZIP'
		keepButton.classList.toggle('btn-outline-warning', entry.keepPinned === true)
		keepButton.classList.toggle('btn-outline-secondary', entry.keepPinned !== true)
		for ( const deleteButton of row.querySelectorAll('.vault-delete-request, .vault-delete-confirm') ) {
			deleteButton.dataset.fileName = entry.fileName ?? ''
			deleteButton.dataset.hash = entry.hash ?? ''
		}
		const rowCheckbox = row.querySelector('.vault-copy-check')
		rowCheckbox.value = entry.hash ?? ''
		rowCheckbox.checked = vaultSelectedHashes.has(entry.hash ?? '')
		rowNode.dataset.collections = JSON.stringify(entry.collections ?? [])
		rowNode.dataset.fileName = entry.fileName ?? ''
		rowNode.dataset.hash = entry.hash ?? ''
		rowNode.dataset.modName = entry.modNames?.[0] ?? entry.fileName ?? ''
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
	fillSelect('vaultCollectionFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.collections ?? [])), 'All collections')
}

async function renderCleanupPanel() {
	const cleanupSize = await DATA.bytesToHR(vaultCleanup.totalSize ?? 0)
	const cleanupCount = vaultCleanup.count ?? 0
	MA.byIdText('vaultCleanupSize', cleanupSize)
	MA.byIdText(
		'vaultCleanupSummary',
		cleanupCount === 0 ?
			'No unused Vault ZIPs are safe to remove right now.' :
			`${cleanupCount} unused Vault ZIP${cleanupCount === 1 ? '' : 's'} can be removed to recover ${cleanupSize}.`
	)
	MA.byIdText(
		'vaultCleanupPreviewSummary',
		cleanupCount === 0 ?
			'Retention rules found no cleanup candidates.' :
			`Preview: ${cleanupCount} candidate file${cleanupCount === 1 ? '' : 's'} selected by retention rules, ${cleanupSize} recoverable.`
	)
	MA.byId('vaultDeleteUnused').disabled = cleanupCount === 0

	const list = MA.byId('vaultCleanupList')
	list.innerHTML = ''
	if ( cleanupCount === 0 ) {
		list.innerHTML = '<div class="list-group-item text-body-secondary">Nothing to clean. Protected rollback/history files are not shown here.</div>'
		await updateCleanupSelectionPreview()
		return
	}

	const rows = await Promise.all(vaultCleanup.entries.map(async (entry) => {
		const size = await DATA.bytesToHR(entry.size ?? 0)
		const row = DATA.templateEngine('vault_cleanup_row', {
			collections : DATA.escapeSpecial(cleanListText(entry.collections)),
			fileName    : DATA.escapeSpecial(entry.fileName ?? ''),
			modName     : DATA.escapeSpecial(entry.modName ?? entry.fileName ?? 'Unknown mod'),
			retentionReason : DATA.escapeSpecial(entry.retentionReason ?? 'Safe cleanup candidate because this ZIP is not protected.'),
			size        : DATA.escapeSpecial(size),
			sources     : DATA.escapeSpecial(cleanListText((entry.sources ?? []).map((source) => friendlySourceName(source)))),
			updatedAt   : DATA.escapeSpecial(formatTimestamp(entry.updatedAt)),
			versions    : DATA.escapeSpecial(cleanListText(entry.versions, 'unknown')),
		})
		row.querySelector('.vault-cleanup-check').value = entry.hash ?? ''
		return fragmentToHTML(row)
	}))
	list.innerHTML = rows.join('')
	await updateCleanupSelectionPreview()
}

async function updateCleanupSelectionPreview() {
	const selectedHashes = new Set([...MA.byId('vaultCleanupList').querySelectorAll('.vault-cleanup-check:checked')].map((checkbox) => checkbox.value))
	const selectedEntries = vaultCleanup.entries.filter((entry) => selectedHashes.has(entry.hash))
	const selectedSize = selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
	const selectedSizeText = await DATA.bytesToHR(selectedSize)
	const selectedCount = selectedEntries.length

	MA.byIdText('vaultCleanupSelectionSummary', `Selected cleanup ZIPs: ${selectedCount}`)
	MA.byIdText('vaultCleanupRecoverableSummary', `Recoverable from selected ZIPs: ${selectedSizeText}`)
	MA.byId('vaultDeleteUnused').disabled = selectedCount === 0
}

async function updateVaultSummary(summary) {
	vaultEntries = summary.entries
	vaultCleanup = summary.cleanup ?? { count : 0, entries : [], totalSize : 0 }
	vaultNotes = summary.notes ?? vaultNotes
	MA.byIdText('vaultCount', summary.totalCount.toString())
	MA.byIdText('vaultUsedCount', summary.usedCount.toString())
	MA.byIdText('vaultSize', await DATA.bytesToHR(summary.totalSize))
	MA.byIdText('vaultFolder', summary.folder)
	await renderCleanupPanel()
	refreshBulkCopyTarget()
	pruneVaultSelection()
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
			storeItemPreviews : storeItemPreviewHTML(group.storeItemPreviews, 6),
			totalSize      : DATA.escapeSpecial(totalSize),
			versionSummary : DATA.escapeSpecial(versionText),
		})
		const nodeRoot = node.querySelector('.vault-group-row')
		node.querySelector('.vault-group-toggle').setAttribute('data-bs-toggle', 'collapse')
		node.querySelector('.vault-group-toggle').setAttribute('data-bs-target', `#${groupBodyId}`)
		node.querySelector('.vault-group-body').id = groupBodyId
		nodeRoot.dataset.collections = JSON.stringify(group.collections)
		nodeRoot.dataset.fileName = group.entries[0]?.fileName ?? ''
		nodeRoot.dataset.hash = group.entries[0]?.hash ?? ''
		nodeRoot.dataset.modName = group.modName
		nodeRoot.title = 'Right-click for mod actions.'
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
	updateVaultSelectionControls()
}

async function loadVault() {
	const [vault, collections] = await Promise.all([
		window.vault_IPC.all(),
		window.vault_IPC.collections(),
	])
	vaultCollections = collections
	await updateVaultSummary(vault)
	refreshFilterOptions()
	await renderVault(filterEntries())
}

async function loadVaultPreservingView() {
	const viewState = captureVaultViewState()
	await loadVault()
	restoreVaultViewState(viewState)
}

async function openVaultDetail(event) {
	event.preventDefault()
	const interactiveTarget = event.target.closest('a, button, input, select, textarea, .vault-technical-details')
	const row = event.target.closest('.vault-file-row, .vault-group-row')
	if ( interactiveTarget !== null || row === null ) {
		window.vault_IPC.textContext()
		return
	}

	let collections = []
	try {
		collections = JSON.parse(row.dataset.collections ?? '[]')
	} catch { /* Invalid display-only metadata should not prevent opening details. */ }

	window.vault_IPC.context({
		collections,
		fileName : row.dataset.fileName ?? '',
		hash     : row.dataset.hash ?? '',
		modName  : row.dataset.modName ?? '',
	})
}

async function handleVaultContextResult(result) {
	if ( result?.action !== 'copy' ) { return }
	if ( result.cancelled ) {
		MA.byIdText('vaultStatus', 'Vault copy cancelled. Nothing was changed.')
		return
	}
	if ( !result.ok ) {
		MA.byIdText('vaultStatus', `Vault copy failed: ${result.error ?? 'Unknown error'}`)
		return
	}

	await loadVaultPreservingView()
	const backupText = result.replacedExisting ? ' The previous collection copy was backed up first.' : ''
	MA.byIdText('vaultStatus', `Copied ${result.fileName} to ${result.collectionName}.${backupText}`)
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
		if ( MA.byId('vaultNoteFilter').value !== '' ) {
			await renderVault(filterEntries())
		}
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
		await loadVaultPreservingView()
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

async function copyVaultHashToCollection(hash, collectionKey) {
	let result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : false })
	if ( result.needsOverwrite ) {
		const confirmed = confirm(`${result.fileName} already exists in ${result.collectionName}. Replace it and save a backup first?`)
		if ( !confirmed ) { return { cancelled : true, result } }
		result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : true })
	}
	return { cancelled : false, result }
}

async function setVaultKeepPinned(button) {
	const hash = button.dataset.hash ?? ''
	const keepPinned = button.dataset.keepPinned === 'true'
	if ( hash === '' ) {
		MA.byIdText('vaultStatus', 'Vault keep action failed: no ZIP was selected.')
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, keepPinned ? 'Keeping...' : 'Unkeeping...')
	try {
		const result = await window.vault_IPC.setKeepPinned({ hash, keepPinned })
		if ( !result.ok ) {
			MA.byIdText('vaultStatus', `Vault keep action failed: ${result.error ?? 'Unknown error'}`)
			return
		}
		const entryName = result.entry?.fileName ?? 'Vault ZIP'
		await loadVaultPreservingView()
		MA.byIdText('vaultStatus', keepPinned ? `${entryName} is now kept and protected from cleanup.` : `${entryName} is no longer manually kept.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault keep action failed: ${err.message}`)
	} finally {
		setButtonState(button, false, originalText)
	}
}

function showVaultDeleteConfirmation(button, shouldShow) {
	const row = button.closest('.vault-file-row')
	const confirmation = row?.querySelector('.vault-delete-confirmation')
	const requestButton = row?.querySelector('.vault-delete-request')
	if ( confirmation === null || typeof confirmation === 'undefined' || requestButton === null || typeof requestButton === 'undefined' ) { return }

	confirmation.classList.toggle('d-none', !shouldShow)
	requestButton.disabled = shouldShow
	const focusTarget = shouldShow ? confirmation.querySelector('.vault-delete-confirm') : requestButton
	focusTarget?.focus({ preventScroll : true })
}

async function deleteVaultEntry(button) {
	const hash = button.dataset.hash ?? ''
	const entry = vaultEntries.find((vaultEntry) => vaultEntry.hash === hash)
	if ( hash === '' || typeof entry === 'undefined' ) {
		MA.byIdText('vaultStatus', 'Vault deletion failed: the selected ZIP could not be found.')
		return
	}
	if ( entry.fileExists !== true || entry.retentionStatus !== 'cleanable' ) {
		MA.byIdText('vaultStatus', 'This Vault ZIP is protected or is no longer eligible for deletion.')
		await loadVaultPreservingView()
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Deleting...')
	try {
		const result = await window.vault_IPC.cleanupUnused({ hashes : [hash] })
		const deletedEntry = result.deleted?.find((item) => item.hash === hash)
		if ( typeof deletedEntry === 'undefined' ) {
			const reason = result.skipped?.[0]?.reason ?? result.errors?.[0]?.error ?? result.error ?? 'The ZIP was not deleted.'
			MA.byIdText('vaultStatus', `Vault deletion failed: ${reason}`)
			await loadVaultPreservingView()
			return
		}

		vaultSelectedHashes.delete(hash)
		await loadVaultPreservingView()
		MA.byIdText('vaultStatus', `Deleted ${deletedEntry.fileName} from the Vault and recovered ${await DATA.bytesToHR(deletedEntry.size ?? 0)}.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault deletion failed: ${err.message}`)
	} finally {
		if ( button.isConnected ) { setButtonState(button, false, originalText) }
		focusVaultSearch()
	}
}

async function copySelectedVaultEntries() {
	const button = MA.byId('vaultBulkCopyButton')
	const select = MA.byId('vaultBulkCopyTarget')
	const status = MA.byId('vaultBulkCopyStatus')
	const collectionKey = select.value
	const hashes = [...vaultSelectedHashes]
	if ( collectionKey === '' ) {
		MA.byIdText('vaultStatus', 'Choose a collection before copying selected Vault ZIPs.')
		status.textContent = 'Choose a collection first.'
		return
	}
	if ( hashes.length === 0 ) {
		MA.byIdText('vaultStatus', 'Select one or more Vault ZIPs before copying.')
		status.textContent = 'Select one or more Vault ZIPs first.'
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Copying selected...')
	status.classList.remove('text-success', 'text-danger')
	status.textContent = `Copying ${hashes.length} selected Vault ZIP${hashes.length === 1 ? '' : 's'}...`
	let copied = 0
	let replaced = 0
	let skipped = 0
	const errors = []

	try {
		for ( const hash of hashes ) {
			// eslint-disable-next-line no-await-in-loop -- Copies may need one-at-a-time overwrite confirmations.
			const { cancelled, result } = await copyVaultHashToCollection(hash, collectionKey)
			if ( cancelled ) {
				skipped++
				continue
			}
			if ( !result.ok ) {
				errors.push(result.error ?? 'Unknown error')
				continue
			}
			copied++
			if ( result.replacedExisting ) { replaced++ }
		}

		await loadVaultPreservingView()
		status.classList.toggle('text-danger', errors.length !== 0)
		status.classList.toggle('text-success', copied !== 0 && errors.length === 0)
		const replacedText = replaced === 0 ? '' : ` ${replaced} existing copy${replaced === 1 ? ' was' : 'ies were'} backed up first.`
		const skippedText = skipped === 0 ? '' : ` ${skipped} copy action${skipped === 1 ? '' : 's'} skipped.`
		const errorText = errors.length === 0 ? '' : ` ${errors.length} copy action${errors.length === 1 ? '' : 's'} failed.`
		const message = `Copied ${copied} selected Vault ZIP${copied === 1 ? '' : 's'}.${replacedText}${skippedText}${errorText}`
		MA.byIdText('vaultStatus', message)
		status.textContent = message
	} catch (err) {
		const message = `Vault bulk copy failed: ${err.message}`
		MA.byIdText('vaultStatus', message)
		status.classList.add('text-danger')
		status.textContent = message
	} finally {
		setButtonState(button, false, originalText)
		updateVaultSelectionControls()
	}
}

function setShownVaultSelection(shouldSelect) {
	for ( const checkbox of MA.byId('vaultList').querySelectorAll('.vault-copy-check') ) {
		const hash = checkbox.value
		checkbox.checked = shouldSelect
		if ( shouldSelect ) {
			vaultSelectedHashes.add(hash)
		} else {
			vaultSelectedHashes.delete(hash)
		}
	}
	updateVaultSelectionControls()
}

async function importCollections() {
	const button = MA.byId('vaultImportCollections')
	button.disabled = true
	const originalText = button.textContent
	button.textContent = 'Scanning collections...'
	MA.byIdText('vaultStatus', 'Scanning collections and adding unique ZIPs to the vault...')
	try {
		const result = await window.vault_IPC.importCollections()
		vaultCollections = await window.vault_IPC.collections()
		await updateVaultSummary(result.summary)
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
	MA.byIdText('vaultStatus', 'Reading ModHub category and version data for vaulted mods. This may take a little while...')
	try {
		const result = await window.vault_IPC.refreshModHub()
		await updateVaultSummary(result.summary)
		refreshFilterOptions()
		await renderVault(filterEntries())
		const errorText = result.errors.length === 0 ? '' : ` ${result.errors.length} ModHub page${result.errors.length === 1 ? '' : 's'} could not be read.`
		const emptyText = result.scanned === 0 ? ' No ModHub IDs were found in the vault yet; scan collections into the vault first, then refresh ModHub information.' : ''
		MA.byIdText('vaultStatus', `Checked ${result.scanned} ModHub-linked vault record${result.scanned === 1 ? '' : 's'} and refreshed ${result.refreshed} ModHub record${result.refreshed === 1 ? '' : 's'}.${errorText}${emptyText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `ModHub information refresh failed: ${err.message}`)
	} finally {
		button.disabled = false
		button.textContent = originalText
	}
}

async function deleteSelectedUnusedVaultFiles() {
	const selectedHashes = [...MA.byId('vaultCleanupList').querySelectorAll('.vault-cleanup-check:checked')].map((checkbox) => checkbox.value)
	if ( selectedHashes.length === 0 ) {
		MA.byIdText('vaultStatus', 'Choose at least one unused Vault ZIP before deleting.')
		return
	}
	const selectedEntries = vaultCleanup.entries.filter((entry) => selectedHashes.includes(entry.hash))
	if ( selectedEntries.length === 0 ) {
		MA.byIdText('vaultStatus', 'The selected cleanup rows could not be matched to Vault files. Refresh the Vault and try again.')
		return
	}
	const selectedSize = selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
	const selectedSizeText = await DATA.bytesToHR(selectedSize)
	const confirmed = confirm(`Delete ${selectedHashes.length} unused Vault ZIP${selectedHashes.length === 1 ? '' : 's'} and recover ${selectedSizeText}?\n\nRollback/history ZIPs are protected and will not be deleted.`)
	if ( !confirmed ) {
		MA.byIdText('vaultStatus', 'Vault cleanup cancelled. Nothing was deleted.')
		return
	}

	const button = MA.byId('vaultDeleteUnused')
	const originalText = button.textContent
	setButtonState(button, true, 'Deleting...')
	try {
		const result = await window.vault_IPC.cleanupUnused({ hashes : selectedHashes })
		if ( typeof result.summary !== 'undefined' ) {
			await updateVaultSummary(result.summary)
			refreshFilterOptions()
			await renderVault(filterEntries())
		}
		if ( result.error ) {
			MA.byIdText('vaultStatus', `Vault cleanup failed: ${result.error}`)
			return
		}
		const recoveredText = await DATA.bytesToHR(result.recoveredSize ?? 0)
		const skippedText = result.skipped?.length > 0 ? ` ${result.skipped.length} item${result.skipped.length === 1 ? '' : 's'} were skipped because they are no longer eligible.` : ''
		const errorText = result.errors?.length > 0 ? ` ${result.errors.length} item${result.errors.length === 1 ? '' : 's'} could not be deleted.` : ''
		MA.byIdText('vaultStatus', `Deleted ${result.deleted.length} unused Vault ZIP${result.deleted.length === 1 ? '' : 's'} and recovered ${recoveredText}.${skippedText}${errorText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault cleanup failed: ${err.message}`)
	} finally {
		setButtonState(button, (vaultCleanup.count ?? 0) === 0, originalText)
		focusVaultSearch()
	}
}

window.addEventListener('DOMContentLoaded', () => {
	window.vault_IPC.receive('vault:contextResult', handleVaultContextResult)
	MA.byId('vaultList').addEventListener('contextmenu', openVaultDetail)
	MA.byId('vaultList').addEventListener('click', (event) => {
		const copyButton = event.target.closest('.vault-copy-button')
		if ( copyButton !== null ) { copyVaultEntry(copyButton) }
		const keepButton = event.target.closest('.vault-keep-button')
		if ( keepButton !== null ) { setVaultKeepPinned(keepButton) }
		const deleteRequest = event.target.closest('.vault-delete-request')
		if ( deleteRequest !== null ) { showVaultDeleteConfirmation(deleteRequest, true) }
		const deleteConfirm = event.target.closest('.vault-delete-confirm')
		if ( deleteConfirm !== null ) { deleteVaultEntry(deleteConfirm) }
		const deleteCancel = event.target.closest('.vault-delete-cancel')
		if ( deleteCancel !== null ) {
			showVaultDeleteConfirmation(deleteCancel, false)
			MA.byIdText('vaultStatus', 'Vault deletion cancelled. Nothing was deleted.')
		}
		const saveNoteButton = event.target.closest('.vault-note-save')
		if ( saveNoteButton !== null ) { saveVaultNote(saveNoteButton) }
		const clearNoteButton = event.target.closest('.vault-note-clear')
		if ( clearNoteButton !== null ) { saveVaultNote(clearNoteButton, true) }
	})
	MA.byId('vaultList').addEventListener('change', (event) => {
		const checkbox = event.target.closest('.vault-copy-check')
		if ( checkbox === null ) { return }
		if ( checkbox.checked ) {
			vaultSelectedHashes.add(checkbox.value)
		} else {
			vaultSelectedHashes.delete(checkbox.value)
		}
		updateVaultSelectionControls()
	})
	MA.byId('vaultTextFilter').addEventListener('input', () => { renderVault(filterEntries()) })
	MA.byId('vaultTypeFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultCategoryFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultModHubCategoryFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultCollectionFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultNoteFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultRollbackFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultUpdateFilter').addEventListener('change', () => { renderVault(filterEntries()) })
	MA.byId('vaultSourceFilter').addEventListener('click', (event) => {
		const sourceButton = event.target.closest('button[data-source]')
		if ( sourceButton !== null ) { setSourceFilter(sourceButton.dataset.source) }
	})
	MA.byId('vaultClearFilters').addEventListener('click', () => {
		MA.byId('vaultTextFilter').value = ''
		MA.byId('vaultTypeFilter').value = ''
		MA.byId('vaultCategoryFilter').value = ''
		MA.byId('vaultModHubCategoryFilter').value = ''
		MA.byId('vaultCollectionFilter').value = ''
		MA.byId('vaultNoteFilter').value = ''
		MA.byId('vaultRollbackFilter').value = ''
		MA.byId('vaultUpdateFilter').value = ''
		setSourceFilter('')
	})
	MA.byId('vaultImportCollections').addEventListener('click', importCollections)
	MA.byId('vaultRefreshModHub').addEventListener('click', refreshModHubCategories)
	MA.byId('vaultShowCleanup').addEventListener('click', () => {
		bootstrap.Collapse.getOrCreateInstance(MA.byId('vaultCleanupPanel')).toggle()
	})
	MA.byId('vaultCleanupList').addEventListener('change', (event) => {
		if ( event.target.closest('.vault-cleanup-check') !== null ) { updateCleanupSelectionPreview() }
	})
	MA.byId('vaultDeleteUnused').addEventListener('click', deleteSelectedUnusedVaultFiles)
	MA.byId('vaultBulkCopyTarget').addEventListener('change', updateVaultSelectionControls)
	MA.byId('vaultBulkCopyButton').addEventListener('click', copySelectedVaultEntries)
	MA.byId('vaultSelectShown').addEventListener('click', () => { setShownVaultSelection(true) })
	MA.byId('vaultSelectNone').addEventListener('click', () => { setShownVaultSelection(false) })
	MA.byId('vaultBackToUpdates').addEventListener('click', () => { window.vault_IPC.dispatchUpdate() })
	loadVault()
})
