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
const { ObjectId } = MongoDb;

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

	// Retrieve sorted items from collection as an array.
	sortedCollection(collectionName, condition, projection, sorting, count) {
		const collection = this.database.collection(collectionName);
		return collection.find(condition)
			.project(projection)
			.sort(sorting)
			.limit(count)
			.toArray();
	}

	// endregion

	// region retrieval

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

	// Internal method to find sorted transactions from query.
	sortedTransactions(collectionName, condition, count) {
		const projection = { 'meta.addresses': 0 };
		const sorting = { 'meta.height': -1, 'meta.index': -1 };
		return this.sortedCollection(collectionName, condition, projection, sorting, count)
			.then(this.sanitizer.deleteIds)
	}

	// Internal method to get transactions up to (non-inclusive) the block height
	// and transaction index, returning at max `numTransactions` items.
	transactionsFromHeightAndIndex(collectionName, height, index, numTransactions) {
		if (0 === numTransactions)
			return Promise.resolve([]);

		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: false } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $lt: index } },
				{ 'meta.height': { $lt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, numTransactions)
			.then(transactions => Promise.resolve(transactions));
	}

	// Internal method to get transactions since (non-inclusive) the block height
	// and transaction index, returning at max `numTransactions` items.
	transactionsSinceHeightAndIndex(collectionName, height, index, numTransactions) {
		if (0 === numTransactions)
			return Promise.resolve([]);

		const condition = { $and: [
			{ 'meta.aggregateId': { $exists: false } },
			{ $or: [
				{ 'meta.height': { $eq: height }, 'meta.index': { $gt: index } },
				{ 'meta.height': { $gt: height } }
			]},
		]};

		return this.sortedTransactions(collectionName, condition, numTransactions)
			.then(transactions => Promise.resolve(transactions));
	}

	// Dummy method, to provide all transactions from (not-including) the earliest.
	// Always empty.
	transactionsFromEarliest(collectionName, numTransactions) {
		return Promise.resolve([]);
	}

	// Get the earliest N transactions since (and including) the earliest transaction.
	transactionsSinceEarliest(collectionName, numTransactions) {
		if (0 === numTransactions)
			return Promise.resolve([]);

		const height = convertToLong(0);
		return this.transactionsSinceHeightAndIndex(collectionName, height, -1, numTransactions);
	}

	// Get the latest N transactions from (and including) the latest transaction.
	transactionsFromLatest(collectionName, numTransactions) {
		if (0 === numTransactions)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const one = convertToLong(1);
			const height = chainStatistic.height.add(one);
			return this.transactionsFromHeightAndIndex(collectionName, height, 0, numTransactions);
		});
	}

	// Dummy method, to provide all transactions since (not-including) the latest.
	// Always empty.
	transactionsSinceLatest(collectionName, numTransactions) {
		return Promise.resolve([]);
	}

	// Get transactions up to (non-inclusive) a transaction object.
	transactionsFromTransaction(collectionName, transaction, numTransactions) {
		const height = transaction.meta.height;
		const index = transaction.meta.index;
		return this.transactionsFromHeightAndIndex(collectionName, height, index, numTransactions);
	}

	// Get transactions since (non-inclusive) a transaction object.
	transactionsSinceTransaction(collectionName, transaction, numTransactions) {
		const height = transaction.meta.height;
		const index = transaction.meta.index;
		return this.transactionsSinceHeightAndIndex(collectionName, height, index, numTransactions);
	}

	// Get transactions up to (non-inclusive) the transaction at hash.
	transactionsFromHash(collectionName, hash, numTransactions) {
		return this.transactionsByHashes([hash]).then(transactions => {
			if (transactions.length !== 1) {
				throw new Error(`invalid transaction hash ${hash}`)
			}
			return this.transactionsFromTransaction(collectionName, transactions[0], numTransactions);
		});
	}

	// Get transactions since (non-inclusive) the transaction at hash.
	transactionsSinceHash(collectionName, hash, numTransactions) {
		return this.transactionsByHashes([hash]).then(transactions => {
			if (transactions.length !== 1) {
				throw new Error(`invalid transaction hash ${hash}`)
			}
			return this.transactionsSinceTransaction(collectionName, transactions[0], numTransactions);
		});
	}

	// Get transactions up to (non-inclusive) the transaction at id.
	transactionsFromId(collectionName, id, numTransactions) {
		return this.transactionsByIds([id]).then(transactions => {
			if (transactions.length !== 1) {
				throw new Error(`invalid transaction id ${id}`)
			}
			return this.transactionsFromTransaction(collectionName, transactions[0], numTransactions);
		});
	}

	// Get transactions since (non-inclusive) the transaction at id.
	transactionsSinceId(collectionName, id, numTransactions) {
		return this.transactionsByIds([id]).then(transactions => {
			if (transactions.length !== 1) {
				throw new Error(`invalid transaction id ${id}`)
			}
			return this.transactionsSinceTransaction(collectionName, transactions[0], numTransactions);
		});
	}

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

	// Internal method to find sorted blocks from query.
	sortedBlocks(collectionName, condition, count) {
		const projection = { 'meta.transactionMerkleTree': 0, 'meta.statementMerkleTree': 0 };
		const sorting = { 'block.height': -1 };
		// Provide a limit of 0: equivalent to no limit.
		return this.sortedCollection(collectionName, condition, projection, sorting, count)
			.then(this.sanitizer.deleteIds);
	}

	// Updated version of blocksFrom.
	// Gets blocks up to (non-inclusive) the height provided,
	// returning at max `numBlocks` items.
	blocksFromHeight(height, numBlocks) {
		if (0 === numBlocks)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const { startHeight, endHeight } = calculateFromHeight(convertToLong(height), chainStatistic.height, numBlocks);
			const condition = { 'block.height': { $gte: startHeight, $lt: endHeight } };
			return this.sortedBlocks('blocks', condition, numBlocks)
				.then(blocks => Promise.resolve(blocks));
		});
	}

	// Gets blocks starting from (non-inclusive) the height provided,
	// returning at max `numBlocks` items.
	blocksSinceHeight(height, numBlocks) {
		if (0 === numBlocks)
			return Promise.resolve([]);

		return this.chainStatisticCurrent().then(chainStatistic => {
			const { startHeight, endHeight } = calculateSinceHeight(convertToLong(height), chainStatistic.height, numBlocks);
			const condition = { 'block.height': { $gt: startHeight, $lte: endHeight } };
      return this.sortedBlocks('blocks', condition, numBlocks)
				.then(blocks => Promise.resolve(blocks));
		});
	}

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
