/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global DATA, I18N, MA */

let historyEntries = []

const fallbackLabels = {
	history_action_update_staged      : 'Update staged',
	history_filter_all_actions        : 'All actions',
	history_filter_all_collections    : 'All collections',
}

function formatTimestamp(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return DATA.escapeSpecial(timestamp ?? '') }
	return date.toLocaleString()
}

function normalValue(value) {
	return (value ?? '').toString().toLowerCase()
}

function dateValue(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return null }
	return date
}

function plainLabel(key) {
	const label = I18N.defer(key, false)
	if ( label.includes('<i18n-text') ) { return fallbackLabels[key] ?? key }
	return label
}

function actionLabelText(action) {
	if ( action === 'update_staged' ) { return plainLabel('history_action_update_staged') }
	return action ?? ''
}

function actionLabel(action) {
	return DATA.escapeSpecial(actionLabelText(action))
}

function fillSelect(selectID, values, allLabelKey) {
	const select = MA.byId(selectID)
	select.innerHTML = ''

	const allOption = document.createElement('option')
	allOption.value = ''
	allOption.textContent = plainLabel(allLabelKey)
	select.appendChild(allOption)

	for ( const value of values ) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = actionLabelText(value)
		if ( selectID === 'historyCollectionFilter' ) { option.textContent = value }
		select.appendChild(option)
	}
}

function setupFilters(entries) {
	const collections = [...new Set(entries.map((entry) => entry.collectionName).filter(Boolean))].sort()
	const actions = [...new Set(entries.map((entry) => entry.action).filter(Boolean))].sort()
	fillSelect('historyCollectionFilter', collections, 'history_filter_all_collections')
	fillSelect('historyActionFilter', actions, 'history_filter_all_actions')
}

function filterHistory(entries) {
	const collectionFilter = MA.byId('historyCollectionFilter').value
	const actionFilter = MA.byId('historyActionFilter').value
	const fromFilter = MA.byId('historyFromFilter').value
	const toFilter = MA.byId('historyToFilter').value
	const textFilter = normalValue(MA.byId('historyTextFilter').value)
	const fromDate = fromFilter === '' ? null : new Date(`${fromFilter}T00:00:00`)
	const toDate = toFilter === '' ? null : new Date(`${toFilter}T23:59:59`)

	return entries.filter((entry) => {
		if ( collectionFilter !== '' && entry.collectionName !== collectionFilter ) { return false }
		if ( actionFilter !== '' && entry.action !== actionFilter ) { return false }

		const entryDate = dateValue(entry.timestamp)
		if ( fromDate !== null && (entryDate === null || entryDate < fromDate) ) { return false }
		if ( toDate !== null && (entryDate === null || entryDate > toDate) ) { return false }

		if ( textFilter !== '' ) {
			const searchText = normalValue([
				entry.action,
				entry.collectionName,
				entry.fileName,
				entry.modName,
				entry.source,
				entry.sourceURL,
				entry.stagedPath,
			].join(' '))
			if ( !searchText.includes(textFilter) ) { return false }
		}

		return true
	})
}

function renderFilteredHistory() {
	renderHistory(filterHistory(historyEntries), historyEntries.length)
}

function renderHistory(entries, totalEntries) {
	const list = MA.byId('historyList')
	list.innerHTML = ''

	if ( entries.length === 0 ) {
		MA.byIdHTML('historyStatus', totalEntries === 0 ? I18N.defer('history_empty', false) : I18N.defer('history_filter_no_matches', false))
		return
	}

	MA.byIdHTML('historyStatus', `${entries.length} / ${totalEntries} ${I18N.defer('history_entries_found', false)}`)

	for ( const entry of entries ) {
		const replaceBadge = entry.replacedExisting ?
			`<span class="badge text-bg-success">${I18N.defer('history_replaced_existing', false)}</span>` :
			''
		const node = DATA.templateEngine('history_line', {
			action         : actionLabel(entry.action),
			collectionName : DATA.escapeSpecial(entry.collectionName ?? ''),
			fileName       : DATA.escapeSpecial(entry.fileName ?? ''),
			modName        : DATA.escapeSpecial(entry.modName ?? ''),
			replaceBadge   : replaceBadge,
			source         : DATA.escapeSpecial(entry.source ?? ''),
			sourceURL      : DATA.escapeSpecial(entry.sourceURL ?? ''),
			stagedPath     : DATA.escapeSpecial(entry.stagedPath ?? ''),
			timestamp      : DATA.escapeSpecial(formatTimestamp(entry.timestamp)),
		})
		list.appendChild(node)
	}
}

window.addEventListener('DOMContentLoaded', () => {
	MA.byId('historyList').addEventListener('contextmenu', window.history_IPC.context)
	MA.byId('historyClearFilters').addEventListener('click', () => {
		for ( const inputID of ['historyCollectionFilter', 'historyActionFilter', 'historyFromFilter', 'historyToFilter', 'historyTextFilter'] ) {
			MA.byId(inputID).value = ''
		}
		renderFilteredHistory()
	})
	for ( const inputID of ['historyCollectionFilter', 'historyActionFilter', 'historyFromFilter', 'historyToFilter', 'historyTextFilter'] ) {
		MA.byId(inputID).addEventListener('input', renderFilteredHistory)
	}
	window.history_IPC.all().then((entries) => {
		historyEntries = entries
		setupFilters(historyEntries)
		renderFilteredHistory()
	})
})
