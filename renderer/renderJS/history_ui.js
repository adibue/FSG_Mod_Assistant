/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global DATA, I18N, MA */

let historyEntries = []

const fallbackLabels = {
	history_action_update_applied     : 'Update applied',
	history_action_update_rolled_back : 'Update rolled back',
	history_action_update_staged      : 'Update staged',
	history_backup_saved              : 'Backup saved',
	history_filter_all_actions        : 'All actions',
	history_filter_all_collections    : 'All collections',
	history_rollback_button           : 'Rollback to this version',
	history_rollback_failed           : 'Rollback failed:',
	history_rollback_restored         : 'Rollback restored.',
	history_rollback_restoring        : 'Restoring rollback backup...',
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
	if ( action === 'update_applied' ) { return plainLabel('history_action_update_applied') }
	if ( action === 'update_rolled_back' ) { return plainLabel('history_action_update_rolled_back') }
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
				entry.backupPath,
				entry.targetPath,
			].join(' '))
			if ( !searchText.includes(textFilter) ) { return false }
		}

		return true
	})
}

function renderFilteredHistory() {
	renderHistory(filterHistory(historyEntries), historyEntries.length)
}

function canRollbackEntry(entry) {
	return typeof entry?.backupPath === 'string' &&
		typeof entry?.targetPath === 'string' &&
		entry.action !== 'update_rolled_back'
}

async function reloadHistory() {
	historyEntries = await window.history_IPC.all()
	setupFilters(historyEntries)
	renderFilteredHistory()
}

async function rollbackHistoryEntry(entry, button) {
	button.disabled = true
	MA.byIdHTML('historyStatus', plainLabel('history_rollback_restoring'))

	const result = await window.history_IPC.rollbackEntry(entry)
	if ( result.ok ) {
		MA.byIdHTML('historyStatus', plainLabel('history_rollback_restored'))
		await reloadHistory()
	} else {
		MA.byIdHTML('historyStatus', `${plainLabel('history_rollback_failed')} ${DATA.escapeSpecial(result.error)}`)
		button.disabled = false
	}
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
		const backupBadge = entry.backupPath ?
			`<span class="badge text-bg-success">${I18N.defer('history_backup_saved', false)}</span>` :
			''
		const backupPath = entry.backupPath ?
			`<div class="small mt-1 history-path user-select-text">${DATA.escapeSpecial(entry.backupPath)}</div>` :
			''
		const targetPath = entry.targetPath ?
			`<div class="small mt-1 history-path user-select-text">${DATA.escapeSpecial(entry.targetPath)}</div>` :
			''
		const rollbackButton = canRollbackEntry(entry) ?
			`<button class="btn btn-sm btn-info mt-2 history-rollback-button" type="button">${DATA.escapeSpecial(plainLabel('history_rollback_button'))}</button>` :
			''
		const node = DATA.templateEngine('history_line', {
			action         : actionLabel(entry.action),
			backupBadge    : backupBadge,
			backupPath     : backupPath,
			collectionName : DATA.escapeSpecial(entry.collectionName ?? ''),
			fileName       : DATA.escapeSpecial(entry.fileName ?? ''),
			modName        : DATA.escapeSpecial(entry.modName ?? ''),
			replaceBadge   : replaceBadge,
			rollbackButton : rollbackButton,
			source         : DATA.escapeSpecial(entry.source ?? ''),
			sourceURL      : DATA.escapeSpecial(entry.sourceURL ?? ''),
			stagedPath     : DATA.escapeSpecial(entry.stagedPath ?? ''),
			targetPath     : targetPath,
			timestamp      : DATA.escapeSpecial(formatTimestamp(entry.timestamp)),
		})
		const rollbackNode = node.querySelector('.history-rollback-button')
		if ( rollbackNode !== null ) {
			rollbackNode.addEventListener('click', () => { rollbackHistoryEntry(entry, rollbackNode) })
		}
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
	MA.byId('historyClearLog').addEventListener('click', async () => {
		if ( !confirm('Clear the collection history log? This will not delete mod backups or mod files.') ) { return }
		const result = await window.history_IPC.clear()
		if ( result.ok ) {
			await reloadHistory()
		}
	})
	for ( const inputID of ['historyCollectionFilter', 'historyActionFilter', 'historyFromFilter', 'historyToFilter', 'historyTextFilter'] ) {
		MA.byId(inputID).addEventListener('input', renderFilteredHistory)
	}
	reloadHistory()
})
