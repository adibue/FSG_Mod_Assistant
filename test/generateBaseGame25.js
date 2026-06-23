/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// FS25 Base Game data generator.
/* eslint no-await-in-loop: "off" */
//
// Usage:
//   node test/generateBaseGame25.js
//   node test/generateBaseGame25.js "C:\Program Files (x86)\Farming Simulator 2025\data"

/* cSpell:disable */
const fs                 = require('node:fs')
const os                 = require('node:os')
const path               = require('node:path')
const process            = require('node:process')
const { globSync }       = require('glob')
const { requiredItems, ddsDecoder } = require('../lib/workerThreadLib.js')
const { baseLooker }     = require('./generateBaseGame_lib.js')

const dataPathCandidates = [
	'C:\\Program Files (x86)\\Farming Simulator 2025\\data',
	'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Farming Simulator 25\\data',
	'C:\\Program Files\\Epic Games\\FarmingSimulator25\\data',
]

const findDataPath = () => {
	if ( typeof process.argv[2] === 'string' ) { return process.argv[2] }

	return dataPathCandidates.find((thisPath) => fs.existsSync(thisPath)) ?? null
}

const dataPath = findDataPath()
const outPath  = process.argv[3] ?? path.join(__dirname, '..', 'renderer', 'renderJS', 'util', 'baseGameData25.js')

const baseData = {
	brandMap        : {},
	brandMap_icon   : {},
	brands          : [],
	byBrand_vehicle : {},
	byCat_placeable : {},
	byCat_vehicle   : {},
	category        : {
		object    : [],
		placeable : [],
		tool      : [],
		vehicle   : [],
	},
	catMap_place    : {},
	catMap_vehicle  : {},
	iconMap         : {},
	joints_has      : {},
	joints_list     : [],
	joints_needs    : {},
	records         : {},
	topLevel        : [
		{ class : 'cat-brand',       page : 'brand',       name : 'basegame_brand'},
		{ class : 'cat-vehicle',     page : 'vehicle',     name : 'basegame_vehicle'},
		{ class : 'cat-tool',        page : 'tool',        name : 'basegame_tool'},
		{ class : 'cat-object',      page : 'object',      name : 'basegame_object'},
		{ class : 'cat-placeable',   page : 'placeable',   name : 'basegame_placeable'},
		{ class : 'cat-attach-has',  page : 'attach_has',  name : 'basegame_attach_has'},
		{ class : 'cat-attach-need', page : 'attach_need', name : 'basegame_attach_need'},
		{ class : 'look-fillunit',   page : 'fills',       name : 'basegame_fills'},
	],
}

const titleCaseBrand = (brand) =>
	brand
		.replace(/^brand_/, '')
		.replaceAll('_', ' ')
		.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())

const addCategory = (topType, categoryID, categoryTitle) => {
	if ( categoryID === null || categoryTitle === null ) { return }

	const mapKey = topType === 'placeable' ? 'catMap_place' : 'catMap_vehicle'

	baseData[mapKey][categoryID] ??= categoryTitle

	if ( baseData.category[topType].some((x) => x.iconName === categoryID) ) { return }

	baseData.category[topType].push({
		iconName : categoryID,
		title    : categoryTitle,
	})
}

const addBrand = (brand) => {
	if ( typeof brand !== 'string' || brand === '' ) { return null }

	const brandID = brand.toLowerCase()
	baseData.brandMap[brandID] ??= titleCaseBrand(brand)
	baseData.brandMap_icon[brandID] ??= `brand_${brandID}`

	if ( ! baseData.brands.some((x) => x.name === brandID) ) {
		baseData.brands.push({
			image : `brand_${brandID}`,
			name  : brandID,
			title : baseData.brandMap[brandID],
		})
	}

	return brandID
}

const getTopType = (record) => {
	if ( record.masterType === 'placeable' ) { return 'placeable' }
	if ( record.isEnterable || record.isMotorized ) { return 'vehicle' }
	if ( record.type === 'object' || record.categoryID?.includes('object') ) { return 'object' }
	return 'tool'
}

const handleRecord = (results, fileDetails) => {
	if ( results.record === null ) { return }

	const thisName = results.shortname
	const record   = results.record
	const topType  = getTopType(record)
	const brandID  = addBrand(record.brand)
	const catID    = record.categoryID ?? record.category

	record.dlcKey   = null
	record.isBase   = true
	record.diskPath = path.relative(fileDetails[1], fileDetails[0]).split(path.sep)

	if ( typeof record.iconOriginalName === 'string' && record.iconOriginalName.startsWith('$data') ) {
		baseData.iconMap[record.iconOriginalName.toLowerCase()] = thisName
	}

	baseData.records[thisName] = record

	if ( record.masterType === 'vehicle' ) {
		if ( brandID !== null ) {
			baseData.byBrand_vehicle[brandID] ??= []
			baseData.byBrand_vehicle[brandID].push(thisName)
		}

		baseData.byCat_vehicle[catID] ??= []
		baseData.byCat_vehicle[catID].push(thisName)

		for ( const thisJoint of record.joints.canUse ) {
			baseData.joints_has[thisJoint] ??= []
			baseData.joints_has[thisJoint].push(thisName)
		}

		for ( const thisJoint of record.joints.needs ) {
			baseData.joints_needs[thisJoint] ??= []
			baseData.joints_needs[thisJoint].push(thisName)
		}
	} else {
		baseData.byCat_placeable[catID] ??= []
		baseData.byCat_placeable[catID].push(thisName)
	}

	addCategory(topType, catID, record.category)
}

const main = async () => {
	if ( dataPath === null || ! fs.existsSync(dataPath) ) {
		throw new Error('FS25 data path does not exist. Provide the path manually, for example: node test/generateBaseGame25.js C:\\Program Files (x86)\\Farming Simulator 2025\\data')
	}

	requiredItems.currentLocale = 'en'
	requiredItems.iconDecoder   = new ddsDecoder(path.join(__dirname, '..', 'texconv.exe'), os.tmpdir())
	requiredItems.l10n_hp       = 'hp'

	const fullFileList = []

	for ( const thisPath of ['vehicles', 'placeables', 'objects'].map((x) => path.join(dataPath, x)) ) {
		const theseFiles = globSync('**/*.xml', { cwd : thisPath, follow : true, mark : true, stat : true, withFileTypes : true })
		for ( const thisFile of theseFiles ) {
			fullFileList.push([thisFile.fullpath(), dataPath, null])
		}
	}

	// eslint-disable-next-line no-console
	console.log(`Processing ${fullFileList.length} FS25 base-game XML files`)

	for ( const [index, fileDetails] of fullFileList.entries() ) {
		const looker  = new baseLooker(fileDetails[0], fileDetails[1])
		const results = await looker.getInfo()

		handleRecord(results, fileDetails)

		if ( index % 100 === 0 ) {
			// eslint-disable-next-line no-console
			console.log(`Processed ${index}/${fullFileList.length}`)
		}
	}

	baseData.joints_list = [...new Set([
		...Object.keys(baseData.joints_has),
		...Object.keys(baseData.joints_needs),
	])].sort()

	baseData.brands.sort((a, b) => Intl.Collator().compare(a.title, b.title))

	for ( const catType of Object.keys(baseData.category) ) {
		baseData.category[catType].sort((a, b) => Intl.Collator().compare(a.title, b.title))
	}

	fs.writeFileSync(
		outPath,
		`/* eslint-disable indent, key-spacing, quotes, comma-dangle, sort-keys */\n/* cSpell:disable */\nconst client_BGData = ${JSON.stringify(baseData, null, 2)}`
	)

	requiredItems.iconDecoder.clearTemp()

	// eslint-disable-next-line no-console
	console.log(`Wrote ${outPath}`)
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error(err)
	process.exitCode = 1
})
