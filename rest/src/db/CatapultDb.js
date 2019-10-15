/*
 * Copyright (c) 2016-present,
 * Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp. All rights reserved.
 *
 * This file is part of Catapult.
 *
 * Catapult is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Catapult is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Catapult.  If not, see <http://www.gnu.org/licenses/>.
 */

/** @module db/CatapultDb */

const connector = require('./connector');
const { convertToLong } = require('./dbUtils');
const catapult = require('catapult-sdk');
const MongoDb = require('mongodb');

const { address, EntityType } = catapult.model;
const { Long, ObjectId } = MongoDb;

const isAggregateType = document => EntityType.aggregateComplete === document.transaction.type
	|| EntityType.aggregateBonded === document.transaction.type;

const createAccountTransactionsAllConditions = (publicKey, networkId) => {
	const decodedAddress = address.publicKeyToAddress(publicKey, networkId);
	const bufferPublicKey = Buffer.from(publicKey);
	const bufferAddress = Buffer.from(decodedAddress);
	return {
		$or: [
			{ 'transaction.cosignatures.signerPublicKey': bufferPublicKey },
			{ 'meta.addresses': bufferAddress }
		]
	};
};

const createSanitizer = () => ({
	copyAndDeleteId: dbObject => {
		if (dbObject) {
			Object.assign(dbObject.meta, { id: dbObject._id });
			delete dbObject._id;
		}

		return dbObject;
	},

	copyAndDeleteIds: dbObjects => {
		dbObjects.forEach(dbObject => {
			Object.assign(dbObject.meta, { id: dbObject._id });
			delete dbObject._id;
		});

		return dbObjects;
	},

	deleteId: dbObject => {
		if (dbObject)
			delete dbObject._id;

		return dbObject;
	},

	deleteIds: dbObjects => {
		dbObjects.forEach(dbObject => {
			delete dbObject._id;
		});
		return dbObjects;
	}
});

const mapToPromise = dbObject => Promise.resolve(null === dbObject ? undefined : dbObject);

const buildBlocksFromOptions = (height, numBlocks, chainHeight) => {
	const one = convertToLong(1);
	const startHeight = height.isZero() ? chainHeight.subtract(numBlocks).add(one) : height;

	// In all cases endHeight is actually max height + 1.
	const calculatedEndHeight = startHeight.add(numBlocks);
	const chainEndHeight = chainHeight.add(one);

	const endHeight = calculatedEndHeight.lessThan(chainEndHeight) ? calculatedEndHeight : chainEndHeight;
	return { startHeight, endHeight, numBlocks: endHeight.subtract(startHeight).toNumber() };
};

const boundPageSize = (pageSize, bounds) => Math.max(bounds.pageSizeMin, Math.min(bounds.pageSizeMax, pageSize));

// Calculate the start and end block height from the provided from height.
const calculateFromHeight = (height, chainHeight, numBlocks) => {
	const one = convertToLong(1);
	const count = convertToLong(numBlocks);
	// We want the numBlocks preceding the height, non-inclusive.
	// If we've provided a number above the blockHeight, go to
	// chainHeight + 1.
	const endHeight = height.greaterThan(chainHeight) ? chainHeight.add(one) : height;
	const startHeight = endHeight.greaterThan(count) ? endHeight.subtract(count) : one;
	return { startHeight, endHeight };
}

// Calculate the start and end block height from the provided since height.
const calculateSinceHeight = (height, chainHeight, numBlocks) => {
	const one = convertToLong(1);
	const count = convertToLong(numBlocks);
	// We want the numBlocks following the height, non-inclusive.
	// If we've provided a number above the blockHeight, go to
	// chainHeight + 1 for the start (returns nothing, even if a block is added).
	const startHeight = height.greaterThan(chainHeight) ? chainHeight.add(one) : height;
	const endHeight = startHeight.add(count);
	return { startHeight, endHeight };
}

// Implied method to add the importance field.
// Calculates if importances is empty, if so, returns Long(0), otherwise,
// extracts the field from the struct.
const addFieldImportanceImpl = (field) => {
	return {
		$cond: {
			if: { $gt: [ { $size: "$account.importances" }, 0 ] },
			then: {
				$let: {
					vars: {
						lastImportance: { $arrayElemAt: [ "$account.importances", -1 ] }
					},
					in: `$$lastImportance.${field}`
				}
			},
			else: { $toLong: 0 }
		}
	};
}

class CatapultDb {
	// region construction / connect / disconnect

	constructor(options) {
		this.networkId = options.networkId;
		if (!this.networkId)
			throw Error('network id is required');

		this.pageSizeMin = options.pageSizeMin || 10;
		this.pageSizeMax = options.pageSizeMax || 100;
		this.sanitizer = createSanitizer();
	}

	connect(url, dbName) {
		return connector.connectToDatabase(url, dbName)
			.then(client => {
				this.client = client;
				this.database = client.db();
			});
	}

	close() {
		if (!this.database)
			return Promise.resolve();

		return new Promise(resolve => {
			this.client.close(resolve);
			this.client = undefined;
			this.database = undefined;
		});
	}

	// endregion

	// region storage helpers

	// Get the minimum signed value for a long.
	minLong() {
		return new Long(0, 0);
	}

	// Get the maximum signed value for a long.
	maxLong() {
		return new Long(0XFFFFFFFF, 0X7FFFFFFF);
	}

	// Get the minimum object ID value.
	minObjectId() {
		return new ObjectId('000000000000000000000000');
	}

	// Get the maximum object ID value.
	maxObjectId() {
		return new ObjectId('FFFFFFFFFFFFFFFFFFFFFFFF');
	}

	// endregion

	// region helpers

	queryDocument(collectionName, conditions, projection) {
		const collection = this.database.collection(collectionName);
		return collection.findOne(conditions, { projection })
			.then(mapToPromise);
	}

	queryDocuments(collectionName, conditions) {
		const collection = this.database.collection(collectionName);
		return collection.find(conditions)
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	queryRawDocuments(collectionName, conditions) {
		return this.database.collection(collectionName).find(conditions).toArray();
	}

	queryDocumentsAndCopyIds(collectionName, conditions, options = {}) {
		const collection = this.database.collection(collectionName);
		return collection.find(conditions)
			.project(options.projection)
			.toArray()
			.then(this.sanitizer.copyAndDeleteIds);
	}

	queryPagedDocuments(collectionName, conditions, id, pageSize, options = {}) {
		const sortOrder = options.sortOrder || -1;
		if (id)
			conditions.$and.push({ _id: { [0 > sortOrder ? '$lt' : '$gt']: new ObjectId(id) } });

		const collection = this.database.collection(collectionName);
		return collection.find(conditions)
			.project(options.projection)
			.sort({ _id: sortOrder })
			.limit(boundPageSize(pageSize, this))
			.toArray();
	}

	// endregion

	// region cursor retrieval helpers

	// Get 0 records as a promise.
	arrayFromEmpty () {
		return Promise.resolve([]);
	}

	// Get the N records from (and including) an absolute duration.
	arrayFromAbsolute(db, method, genArgs, collectionName, ...args) {
		// Count is always provided as the last argument.
		if (0 === args[args.length - 1])
			return this.arrayFromEmpty();
		const methodArgs = genArgs();
		return db[method](collectionName, ...methodArgs, ...args);
	}

	// Get records relative to (non-inclusive) a provided record.
	arrayFromRecord(db, method, genArgs, collectionName, record, ...args) {
		if (undefined === record)
			return undefined;
		// Count is always provided as the last argument.
		if (0 === args[args.length - 1])
			return this.arrayFromEmpty();
		const methodArgs = genArgs(record);
		return db[method](collectionName, ...methodArgs, ...args);
	}

	// Get records relative to (non-inclusive) a record looked up by an ID.
	arrayFromId(db, arrayMethod, idMethod, collectionName, id, ...args) {
		return db[idMethod](collectionName, id).then(record => {
			return db[arrayMethod](collectionName, record, ...args);
		});
	}

	// endregion

	// region chain retrieval

	/**
	 * Retrieves sizes of database collections.
	 * @returns {Promise} Promise that resolves to the sizes of collections in the database.
	 */
	storageInfo() {
		const blockCountPromise = this.database.collection('blocks').countDocuments();
		const transactionCountPromise = this.database.collection('transactions').countDocuments();
		const accountCountPromise = this.database.collection('accounts').countDocuments();
		return Promise.all([blockCountPromise, transactionCountPromise, accountCountPromise])
			.then(storageInfo => ({ numBlocks: storageInfo[0], numTransactions: storageInfo[1], numAccounts: storageInfo[2] }));
	}

	chainStatistic() {
		return this.queryDocument('chainStatistic', {}, { _id: 0 });
	}

	chainStatisticCurrent() {
		return this.queryDocument('chainStatistic', {}, { _id: 0 })
			.then(chainStatistic => chainStatistic.current);
	}

	// end retrieval

	// region block retrieval

	blockAtHeight(height) {
		return this.queryDocument(
			'blocks',
			{ 'block.height': convertToLong(height) },
			{ 'meta.transactionMerkleTree': 0, 'meta.statementMerkleTree': 0 }
		).then(this.sanitizer.deleteId);
	}

	blockWithMerkleTreeAtHeight(height, merkleTreeName) {
		const blockMerkleTreeNames = ['transactionMerkleTree', 'statementMerkleTree'];
		const excludedMerkleTrees = {};
		blockMerkleTreeNames.filter(merkleTree => merkleTree !== merkleTreeName)
			.forEach(merkleTree => { excludedMerkleTrees[`meta.${merkleTree}`] = 0; });
		return this.queryDocument('blocks', { 'block.height': convertToLong(height) }, excludedMerkleTrees)
			.then(this.sanitizer.deleteId);
	}

	blocksFrom(height, numBlocks) {
		if (0 === numBlocks)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const blockCollection = this.database.collection('blocks');
			const options = buildBlocksFromOptions(convertToLong(height), convertToLong(numBlocks), chainStatistic.height);

			return blockCollection.find({ 'block.height': { $gte: options.startHeight, $lt: options.endHeight } })
				.project({ 'meta.transactionMerkleTree': 0, 'meta.statementMerkleTree': 0 })
				.sort({ 'block.height': -1 })
				.toArray()
				.then(this.sanitizer.deleteIds)
				.then(blocks => Promise.resolve(blocks));
		});
	}

	// endregion

  // region cursor block retrieval

	// Internal method to find sorted blocks from query.
	sortedBlocks(collectionName, condition, count) {
		const projection = { 'meta.transactionMerkleTree': 0, 'meta.statementMerkleTree': 0 };
		const sorting = { 'block.height': -1 };
		return this.database.collection(collectionName)
			.find(condition)
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	// Updated version of blocksFrom.
	// Gets blocks up to (non-inclusive) the height provided,
	// returning at max `count` items.
	blocksFromHeight(collectionName, height, count) {
		if (0 === count)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const { startHeight, endHeight } = calculateFromHeight(convertToLong(height), chainStatistic.height, count);
			const condition = { 'block.height': { $gte: startHeight, $lt: endHeight } };
			return this.sortedBlocks(collectionName, condition, count)
				.then(blocks => Promise.resolve(blocks));
		});
	}

	// Gets blocks starting from (non-inclusive) the height provided,
	// returning at max `count` items.
	blocksSinceHeight(collectionName, height, count) {
		if (0 === count)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const { startHeight, endHeight } = calculateSinceHeight(convertToLong(height), chainStatistic.height, count);
			const condition = { 'block.height': { $gt: startHeight, $lte: endHeight } };
      return this.sortedBlocks(collectionName, condition, count)
				.then(blocks => Promise.resolve(blocks));
		});
	}

	// endregion

	// region transaction retrieval

	queryDependentDocuments(collectionName, aggregateIds) {
		if (0 === aggregateIds.length)
			return Promise.resolve([]);

		return this.queryDocumentsAndCopyIds(collectionName, { 'meta.aggregateId': { $in: aggregateIds } });
	}

	queryTransactions(conditions, id, pageSize, options) {
		// don't expose private meta.addresses field
		const optionsWithProjection = Object.assign({ projection: { 'meta.addresses': 0 } }, options);

		// filter out dependent documents
		const collectionName = (options || {}).collectionName || 'transactions';
		const transactionConditions = { $and: [{ 'meta.aggregateId': { $exists: false } }, conditions] };

		return this.queryPagedDocuments(collectionName, transactionConditions, id, pageSize, optionsWithProjection)
			.then(this.sanitizer.copyAndDeleteIds)
			.then(transactions => {
				const aggregateIds = [];
				const aggregateIdToTransactionMap = {};
				transactions
					.filter(isAggregateType)
					.forEach(document => {
						const aggregateId = document.meta.id;
						aggregateIds.push(aggregateId);
						aggregateIdToTransactionMap[aggregateId.toString()] = document.transaction;
					});

				return this.queryDependentDocuments(collectionName, aggregateIds).then(dependentDocuments => {
					dependentDocuments.forEach(dependentDocument => {
						const transaction = aggregateIdToTransactionMap[dependentDocument.meta.aggregateId];
						if (!transaction.transactions)
							transaction.transactions = [];

						transaction.transactions.push(dependentDocument);
					});

					return transactions;
				});
			});
	}

	transactionsAtHeight(height, id, pageSize) {
		return this.queryTransactions({ 'meta.height': convertToLong(height) }, id, pageSize, { sortOrder: 1 });
	}

	transactionsByIdsImpl(collectionName, conditions) {
		return this.queryDocumentsAndCopyIds(collectionName, conditions, { projection: { 'meta.addresses': 0 } })
			.then(documents => Promise.all(documents.map(document => {
				if (!document || !isAggregateType(document))
					return document;

				return this.queryDependentDocuments(collectionName, [document.meta.id]).then(dependentDocuments => {
					dependentDocuments.forEach(dependentDocument => {
						if (!document.transaction.transactions)
							document.transaction.transactions = [];

						document.transaction.transactions.push(dependentDocument);
					});

					return document;
				});
			})));
	}

	transactionsByIds(ids) {
		return this.transactionsByIdsImpl('transactions', { _id: { $in: ids.map(id => new ObjectId(id)) } });
	}

	transactionsByHashes(hashes) {
		return this.transactionsByIdsImpl('transactions', { 'meta.hash': { $in: hashes.map(hash => Buffer.from(hash)) } });
	}

	transactionsByHashesUnconfirmed(hashes) {
		return this.transactionsByIdsImpl('unconfirmedTransactions', { 'meta.hash': { $in: hashes.map(hash => Buffer.from(hash)) } });
	}

	transactionsByHashesPartial(hashes) {
		return this.transactionsByIdsImpl('partialTransactions', { 'meta.hash': { $in: hashes.map(hash => Buffer.from(hash)) } });
	}

	/**
	 * Return (id, name, parent) tuples for transactions with type and with id in set of ids.
	 * @param {*} ids Set of transaction ids.
	 * @param {*} transactionType Transaction type.
	 * @param {object} fieldNames Descriptor for fields used in query.
	 * @returns {Promise.<array>} Promise that is resolved when tuples are ready.
	 */
	findNamesByIds(ids, transactionType, fieldNames) {
		const queriedIds = ids.map(convertToLong);
		const conditions = {
			$match: {
				'transaction.type': transactionType,
				[`transaction.${fieldNames.id}`]: { $in: queriedIds }
			}
		};

		const grouping = {
			$group: {
				_id: `$transaction.${fieldNames.id}`,
				[fieldNames.id]: { $first: `$transaction.${fieldNames.id}` },
				[fieldNames.name]: { $first: `$transaction.${fieldNames.name}` },
				[fieldNames.parentId]: { $first: `$transaction.${fieldNames.parentId}` }
			}
		};

		const collection = this.database.collection('transactions');
		return collection.aggregate([conditions, grouping])
			.sort({ _id: -1 })
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	// endregion

  // region raw transaction retrieval

	// Internal method: retrieve transaction by hash.
	// Does not process internal _id.
  rawTransactionByHash(collectionName, hash) {
		const condition = { 'meta.hash': { $eq: Buffer.from(hash) } };
		return this.queryDocument(collectionName, condition);
  }

	// Internal method: retrieve transaction by ID.
	// Does not process internal _id.
  rawTransactionById(collectionName, id) {
		const transactionId = new ObjectId(id);
		const condition = { _id: { $eq: transactionId } };
		return this.queryDocument(collectionName, condition)
			.then(this.sanitizer.copyAndDeleteId);
  }

	// endregion

  // region cursor transaction retrieval

	// Internal method to find sorted transactions from query.
	sortedTransactions(collectionName, condition, count) {
		const projection = { 'meta.addresses': 0 };
		const sorting = { 'meta.height': -1, 'meta.index': -1 };
		return this.database.collection(collectionName)
			.find(condition)
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.sanitizer.copyAndDeleteIds);
	}

	// Internal method to get transactions up to (non-inclusive) the block height
	// and transaction index, returning at max `count` items.
	transactionsFrom(collectionName, height, index, count) {
		const isAggregate = collectionName === 'partialTransactions';
		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: isAggregate } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $lt: index } },
				{ 'meta.height': { $lt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, count)
			.then(transactions => Promise.resolve(transactions));
	}

	// Internal method to get transactions since (non-inclusive) the block height
	// and transaction index, returning at max `count` items.
	transactionsSince(collectionName, height, index, count) {
		const isAggregate = collectionName === 'partialTransactions';
		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: isAggregate } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $gt: index } },
				{ 'meta.height': { $gt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, count)
			.then(transactions => Promise.resolve(transactions));
	}

	transactionsFromEarliest(...args) {
		return this.arrayFromEmpty();
	}

	transactionsSinceEarliest(...args) {
		const method = 'transactionsSince';
		const genArgs = () => [this.minLong(), -1];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	transactionsFromLatest(...args) {
		const method = 'transactionsFrom';
		const genArgs = () => [this.maxLong(), 0];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	transactionsSinceLatest(...args) {
		return this.arrayFromEmpty();
	}

	transactionsFromTransaction(...args) {
		const method = 'transactionsFrom';
		const genArgs = (info) => [info.meta.height, info.meta.index];
		return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	transactionsSinceTransaction(...args) {
		const method = 'transactionsSince';
		const genArgs = (info) => [info.meta.height, info.meta.index];
		return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	transactionsFromHash(...args) {
		return this.arrayFromId(this, 'transactionsFromTransaction', 'rawTransactionByHash', ...args);
	}

	transactionsSinceHash(...args) {
		return this.arrayFromId(this, 'transactionsSinceTransaction', 'rawTransactionByHash', ...args);
	}

	transactionsFromId(...args) {
		return this.arrayFromId(this, 'transactionsFromTransaction', 'rawTransactionById', ...args);
	}

	transactionsSinceId(...args) {
		return this.arrayFromId(this, 'transactionsSinceTransaction', 'rawTransactionById', ...args);
	}

	// endregion

  // region cursor transaction by type retrieval

	// Internal method to get transactions filtered by type up to (non-inclusive) the block height
	// and transaction index, returning at max `numTransactions` items.
	transactionsByTypeFrom(collectionName, height, index, type, count) {
		const isAggregate = collectionName === 'partialTransactions';
		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: isAggregate } },
			{ 'transaction.type': { $eq: type } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $lt: index } },
				{ 'meta.height': { $lt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, count)
			.then(transactions => Promise.resolve(transactions));
	}

	// Internal method to get transactions filtered by type since (non-inclusive) the block height
	// and transaction index, returning at max `numTransactions` items.
	transactionsByTypeSince(collectionName, height, index, type, count) {
		const isAggregate = collectionName === 'partialTransactions';
		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: isAggregate } },
			{ 'transaction.type': { $eq: type } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $gt: index } },
				{ 'meta.height': { $gt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, count)
			.then(transactions => Promise.resolve(transactions));
	}

	transactionsByTypeFromEarliest(...args) {
		return this.arrayFromEmpty();
	}

	transactionsByTypeSinceEarliest(...args) {
		const method = 'transactionsByTypeSince';
		const genArgs = () => [this.minLong(), -1];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	transactionsByTypeFromLatest(...args) {
		const method = 'transactionsByTypeFrom';
		const genArgs = () => [this.maxLong(), 0];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	transactionsByTypeSinceLatest(...args) {
		return this.arrayFromEmpty();
	}

	transactionsByTypeFromTransaction(...args) {
		const method = 'transactionsByTypeFrom';
		const genArgs = (info) => [info.meta.height, info.meta.index];
		return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	transactionsByTypeSinceTransaction(...args) {
		const method = 'transactionsByTypeSince';
		const genArgs = (info) => [info.meta.height, info.meta.index];
		return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	transactionsByTypeFromHash(...args) {
		return this.arrayFromId(this, 'transactionsByTypeFromTransaction', 'rawTransactionByHash', ...args);
	}

	transactionsByTypeSinceHash(...args) {
		return this.arrayFromId(this, 'transactionsByTypeSinceTransaction', 'rawTransactionByHash', ...args);
	}

	transactionsByTypeFromId(...args) {
		return this.arrayFromId(this, 'transactionsByTypeFromTransaction', 'rawTransactionById', ...args);
	}

	transactionsByTypeSinceId(...args) {
		return this.arrayFromId(this, 'transactionsByTypeSinceTransaction', 'rawTransactionById', ...args);
	}

	// endregion

	// region transaction retrieval for account

	accountTransactionsAll(publicKey, id, pageSize, ordering) {
		const conditions = createAccountTransactionsAllConditions(publicKey, this.networkId);
		return this.queryTransactions(conditions, id, pageSize, { sortOrder: ordering });
	}

	accountTransactionsIncoming(accountAddress, id, pageSize, ordering) {
		const bufferAddress = Buffer.from(accountAddress);
		return this.queryTransactions({ 'transaction.recipientAddress': bufferAddress }, id, pageSize, { sortOrder: ordering });
	}

	accountTransactionsOutgoing(publicKey, id, pageSize, ordering) {
		const bufferPublicKey = Buffer.from(publicKey);
		return this.queryTransactions({ 'transaction.signerPublicKey': bufferPublicKey }, id, pageSize, { sortOrder: ordering });
	}

	accountTransactionsUnconfirmed(publicKey, id, pageSize, ordering) {
		const conditions = createAccountTransactionsAllConditions(publicKey, this.networkId);
		return this.queryTransactions(conditions, id, pageSize, { collectionName: 'unconfirmedTransactions', sortOrder: ordering });
	}

	accountTransactionsPartial(publicKey, id, pageSize, ordering) {
		const conditions = createAccountTransactionsAllConditions(publicKey, this.networkId);
		return this.queryTransactions(conditions, id, pageSize, { collectionName: 'partialTransactions', sortOrder: ordering });
	}

	// endregion

	// region account retrieval

	accountsByIds(ids) {
		// id will either have address property or publicKey property set; in the case of publicKey, convert it to address
		const buffers = ids.map(id => Buffer.from((id.publicKey ? address.publicKeyToAddress(id.publicKey, this.networkId) : id.address)));
		return this.queryDocuments('accounts', { 'account.address': { $in: buffers } })
			.then(entities => entities.map(accountWithMetadata => {
				const { account } = accountWithMetadata;
				if (0 < account.importances.length) {
					const importanceSnapshot = account.importances.pop();
					account.importance = importanceSnapshot.value;
					account.importanceHeight = importanceSnapshot.height;
				} else {
					account.importance = convertToLong(0);
					account.importanceHeight = convertToLong(0);
				}

				delete account.importances;
				return accountWithMetadata;
			}));
	}

	// endregion

	// region cursor account helpers

	// Helper methods to add importance field.
	addFieldImportance() {
		return addFieldImportanceImpl('value');
	}

	// Helper methods to add importanceHeight field.
	addFieldImportanceHeight() {
		return addFieldImportanceImpl('height');
	}

	// Helper methods to add the harvestedBlocks field.
	addFieldHarvestedBlocks() {
		return { $size: "$account.activityBuckets" };
	}

	// Helper methods to add the harvestedFees field.
	addFieldHarvestedFees() {
		// Sum reduce over `totalFeesPaid` in `account.activityBuckets`.
		return {
			$reduce: {
				input: "$account.activityBuckets",
				initialValue: { $toLong: 0 },
				in: { $add: ["$$value", "$$this.totalFeesPaid"] }
 			}
		};
	}

	// Retrieve account by address with custom fields added and projected.
	rawAccountByAddress(collectionName, address, addFields, projection) {
		const aggregation = [
			{ $match: { 'account.address': { $eq: Buffer.from(address) } } },
			addFields
		];
		return this.database.collection(collectionName)
			.aggregate(aggregation, { promoteLongs: false })
			.project(projection)
			.limit(1)
			.toArray()
			.then(accounts => Promise.resolve(accounts[0]));
	}

	// Since the public key isn't unique for the network's private key,
	// and the calculation doesn't generate the right address,
	// this may not work for all data, but it's accurate for everything else.
	publicKeyToAddress(publicKey) {
		return address.publicKeyToAddress(publicKey, this.networkId);
	}

	// endregion

	// region cursor account by importance retrieval

	rawAccountWithImportanceByAddress(collectionName, address) {
		const addFields = { $addFields: {
			'account.importance': this.addFieldImportance(),
			'account.importanceHeight': this.addFieldImportanceHeight()
		} };
		const projection = { 'account.importances': 0 };
		return this.rawAccountByAddress(collectionName, address, addFields, projection);
	}

	rawAccountWithImportanceByPublicKey(collectionName, publicKey) {
		const address = this.publicKeyToAddress(publicKey);
		return this.rawAccountWithImportanceByAddress(collectionName, address);
	}

	// Internal method to find sorted accounts by importance from query.
	sortedAccountsByImportance(collectionName, match, count) {
		const aggregation = [
			{ $addFields: {
				'account.importance': this.addFieldImportance(),
				'account.importanceHeight': this.addFieldImportanceHeight()
			} },
			{ $match: match }
		];
		// Need secondary public key height and ID height to sort by when the
		// account's public key was known to network.
		const sorting = { 'account.importance': -1, 'account.publicKeyHeight': -1, _id: -1 };
		const projection = { 'account.importances': 0 };

		return this.database.collection(collectionName)
			.aggregate(aggregation, { promoteLongs: false })
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	// Generate an account match condition from a field, an ordering,
	// and the publicKeyHeight and the object ID.
	accountMatchCondition(field, ordering, value, height, id) {
		// Match if the account field is less than the provided field
		// If the fields are equal, match if the height is less than the
		// public key height. If equal, match if the ID is less than the provided ID.
		return { $or: [
			{ [`account.${field}`]: { [ordering]: value } },
			{ $and: [
				{ [`account.${field}`]: { $eq: value } },
				{ $or: [
					{ 'meta.publicKeyHeight': { $eq: height }, _id: { [ordering]: id } },
					{ 'meta.publicKeyHeight': { [ordering]: height } }
				]},
			]},
		]};
	}

	// Internal method: get accounts up to (non-inclusive) the account with importance, height,
	// and ID, returning at max `numAccounts` items.
	accountsByImportanceFrom(collectionName, importance, height, id, numAccounts) {
		const match = this.accountMatchCondition('importance', '$lt', importance, height, id);
		return this.sortedAccountsByImportance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	// Internal method: get accounts since (non-inclusive) the account with importance, height,
	// and ID, returning at max `numAccounts` items.
	accountsByImportanceSince(collectionName, importance, height, id, numAccounts) {
		const match = this.accountMatchCondition('importance', '$gt', importance, height, id);
		return this.sortedAccountsByImportance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByImportanceFromLeast(...args) {
		return this.arrayFromEmpty();
	}

	accountsByImportanceSinceLeast(...args) {
		const method = 'accountsByImportanceSince';
		const genArgs = () => [this.minLong(), this.minLong(), this.minObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByImportanceFromMost(...args) {
		const method = 'accountsByImportanceFrom';
		const genArgs = () => [this.maxLong(), this.maxLong(), this.maxObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByImportanceSinceMost(...args) {
		return this.arrayFromEmpty();
	}

	accountsByImportanceFromAccount(...args) {
		const method = 'accountsByImportanceFrom';
    const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByImportanceSinceAccount(...args) {
		const method = 'accountsByImportanceFrom';
		const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByImportanceFromAddress(...args) {
		return this.arrayFromId(this, 'accountsByImportanceFromAccount', 'rawAccountWithImportanceByAddress', ...args);
	}

	accountsByImportanceSinceAddress(...args) {
		return this.arrayFromId(this, 'accountsByImportanceSinceAccount', 'rawAccountWithImportanceByAddress', ...args);
	}

	accountsByImportanceFromPublicKey(...args) {
		return this.arrayFromId(this, 'accountsByImportanceFromAccount', 'rawAccountWithImportanceByPublicKey', ...args);
	}

	accountsByImportanceSincePublicKey(...args) {
		return this.arrayFromId(this, 'accountsByImportanceSinceAccount', 'rawAccountWithImportanceByPublicKey', ...args);
	}

	// endregion

	// region cursor account by harvested blocks retrieval

	rawAccountWithHarvestedBlocksByAddress(collectionName, address) {
		const addFields = { $addFields: {
			'account.importance': this.addFieldImportance(),
			'account.importanceHeight': this.addFieldImportanceHeight(),
			'account.harvestedBlocks': this.addFieldHarvestedBlocks()
		} };
		const projection = { 'account.importances': 0, 'account.harvestedBlocks': 0 };
		return this.rawAccountByAddress(collectionName, address, addFields, projection);
	}

	rawAccountWithHarvestedBlocksByPublicKey(collectionName, publicKey) {
		const address = this.publicKeyToAddress(publicKey);
		return this.rawAccountWithHarvestedBlocksByAddress(collectionName, address);
	}

	// Internal method to find sorted accounts by harvested blocks from query.
	sortedAccountsByHarvestedBlocks(collectionName, match, count) {
		const aggregation = [
			{ $addFields: {
				'account.importance': this.addFieldImportance(),
				'account.importanceHeight': this.addFieldImportanceHeight(),
				'account.harvestedBlocks': this.addFieldHarvestedBlocks()
			} },
			{ $match: match }
		];
		// Need secondary public key height and ID height to sort by when the
		// account's public key was known to network.
		const sorting = { 'account.harvestedBlocks': -1, 'account.publicKeyHeight': -1, _id: -1 };
		const projection = { 'account.importances': 0, 'account.harvestedBlocks': 0 };

		return this.database.collection(collectionName)
			.aggregate(aggregation, { promoteLongs: false })
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	// Internal method: get accounts up to (non-inclusive), returning at max `numAccounts` items.
	accountsByHarvestedBlocksFrom(collectionName, harvestedBlocks, height, id, numAccounts) {
		const match = this.accountMatchCondition('harvestedBlocks', '$lt', harvestedBlocks, height, id);
		return this.sortedAccountsByHarvestedBlocks(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	// Internal method: get accounts since (non-inclusive), returning at max `numAccounts` items.
	accountsByHarvestedBlocksSince(collectionName, harvestedBlocks, height, id, numAccounts) {
		const match = this.accountMatchCondition('harvestedBlocks', '$gt', harvestedBlocks, height, id);
		return this.sortedAccountsByHarvestedBlocks(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByHarvestedBlocksFromLeast(...args) {
		return this.arrayFromEmpty();
	}

	accountsByHarvestedBlocksSinceLeast(...args) {
		const method = 'accountsByHarvestedBlocksSince';
		const genArgs = () => [this.minLong(), this.minLong(), this.minObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestedBlocksFromMost(...args) {
		const method = 'accountsByHarvestedBlocksFrom';
		const genArgs = () => [this.maxLong(), this.maxLong(), this.maxObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestedBlocksSinceMost(...args) {
		return this.arrayFromEmpty();
	}

	accountsByHarvestedBlocksFromAccount(...args) {
		const method = 'accountsByHarvestedBlocksFrom';
    const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestedBlocksSinceAccount(...args) {
		const method = 'accountsByHarvestedBlocksFrom';
		const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestedBlocksFromAddress(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedBlocksFromAccount', 'rawAccountWithHarvestedBlocksByAddress', ...args);
	}

	accountsByHarvestedBlocksSinceAddress(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedBlocksSinceAccount', 'rawAccountWithHarvestedBlocksByAddress', ...args);
	}

	accountsByHarvestedBlocksFromPublicKey(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedBlocksFromAccount', 'rawAccountWithHarvestedBlocksByPublicKey', ...args);
	}

	accountsByHarvestedBlocksSincePublicKey(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedBlocksSinceAccount', 'rawAccountWithHarvestedBlocksByPublicKey', ...args);
	}

	// endregion

	// region cursor account by harvested fees retrieval

	rawAccountWithHarvestedFeesByAddress(collectionName, address) {
		const addFields = { $addFields: {
			'account.importance': this.addFieldImportance(),
			'account.importanceHeight': this.addFieldImportanceHeight(),
			'account.harvestedBlocks': this.addFieldHarvestedBlocks(),
			'account.harvestedFees': this.addFieldHarvestedFees()
		} };
		const projection = { 'account.importances': 0, 'account.harvestedBlocks': 0, 'account.harvestedFees': 0 };
		return this.rawAccountByAddress(collectionName, address, addFields, projection);
	}

	rawAccountWithHarvestedFeesByPublicKey(collectionName, publicKey) {
		const address = this.publicKeyToAddress(publicKey);
		return this.rawAccountWithHarvestedFeesByAddress(collectionName, address);
	}

	// Internal method to find sorted accounts by harvested fees from query.
	sortedAccountsByHarvestedFees(collectionName, match, count) {
		const aggregation = [
			{ $addFields: {
				'account.importance': this.addFieldImportance(),
				'account.importanceHeight': this.addFieldImportanceHeight(),
				'account.harvestedBlocks': this.addFieldHarvestedBlocks(),
				'account.harvestedFees': this.addFieldHarvestedFees()
			} },
			{ $match: match }
		];
		// Sort by harvested blocks after to break ties: more attempted harvested,
		// should score higher.
		// Need secondary public key height and ID height to sort by when the
		// account's public key was known to network.
		const sorting = { 'account.harvestedFees': -1, 'account.harvestedBlocks': -1, 'account.publicKeyHeight': -1, _id: -1 };
		const projection = { 'account.importances': 0, 'account.harvestedBlocks': 0, 'account.harvestedFees': 0 };

		return this.database.collection(collectionName)
			.aggregate(aggregation, { promoteLongs: false })
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.sanitizer.deleteIds);
	}

	// Internal method: get accounts up to (non-inclusive), returning at max `numAccounts` items.
	accountsByHarvestedFeesFrom(collectionName, harvestedFees, height, id, numAccounts) {
		const match = this.accountMatchCondition('harvestedFees', '$lt', harvestedFees, height, id);
		return this.sortedAccountsByHarvestedFees(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	// Internal method: get accounts since (non-inclusive), returning at max `numAccounts` items.
	accountsByHarvestedFeesSince(collectionName, harvestedFees, height, id, numAccounts) {
		const match = this.accountMatchCondition('harvestedFees', '$gt', harvestedFees, height, id);
		return this.sortedAccountsByHarvestedFees(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByHarvestedFeesFromLeast(...args) {
		return this.arrayFromEmpty();
	}

	accountsByHarvestedFeesSinceLeast(...args) {
		const method = 'accountsByHarvestedFeesSince';
		const genArgs = () => [this.minLong(), this.minLong(), this.minObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestedFeesFromMost(...args) {
		const method = 'accountsByHarvestedFeesFrom';
		const genArgs = () => [this.maxLong(), this.maxLong(), this.maxObjectId()];
		return this.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestedFeesSinceMost(...args) {
		return this.arrayFromEmpty();
	}

	accountsByHarvestedFeesFromAccount(...args) {
		const method = 'accountsByHarvestedFeesFrom';
    const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestedFeesSinceAccount(...args) {
		const method = 'accountsByHarvestedFeesFrom';
		const genArgs = (account) => [account.account.importance, account.account.publicKeyHeight, account._id];
    return this.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestedFeesFromAddress(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedFeesFromAccount', 'rawAccountWithHarvestedFeesByAddress', ...args);
	}

	accountsByHarvestedFeesSinceAddress(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedFeesSinceAccount', 'rawAccountWithHarvestedFeesByAddress', ...args);
	}

	accountsByHarvestedFeesFromPublicKey(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedFeesFromAccount', 'rawAccountWithHarvestedFeesByPublicKey', ...args);
	}

	accountsByHarvestedFeesSincePublicKey(...args) {
		return this.arrayFromId(this, 'accountsByHarvestedFeesSinceAccount', 'rawAccountWithHarvestedFeesByPublicKey', ...args);
	}

	// endregion

	// region failed transaction

	/**
	 * Retrieves transaction results for the given hashes.
	 * @param {Array.<Uint8Array>} hashes Transaction hashes.
	 * @returns {Promise.<Array>} Promise that resolves to the array of hash / validation result pairs.
	 */
	transactionsByHashesFailed(hashes) {
		const buffers = hashes.map(hash => Buffer.from(hash));
		return this.queryDocuments('transactionStatuses', { 'status.hash': { $in: buffers } });
	}

	// endregion

	// region utils

	/**
	 * Retrieves account publickey projection for the given address.
	 * @param {Uint8Array} accountAddress Account address.
	 * @returns {Promise<Buffer>} Promise that resolves to the account public key.
	 */
	addressToPublicKey(accountAddress) {
		const conditions = { 'account.address': Buffer.from(accountAddress) };
		const projection = { 'account.publicKey': 1 };
		return this.queryDocument('accounts', conditions, projection);
	}

	// endregion
}

module.exports = CatapultDb;
