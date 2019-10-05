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

const { convertToLong } = require('../../db/dbUtils');
const AccountType = require('../AccountType');
const catapult = require('catapult-sdk');
const MongoDb = require('mongodb');

const { Long, ObjectId } = MongoDb;
const { uint64 } = catapult.utils;

const createActiveConditions = () => {
	const conditions = { $and: [{ 'meta.active': true }] };
	return conditions;
};

class NamespaceDb {
	/**
	 * Creates NamespaceDb around CatapultDb.
	 * @param {module:db/CatapultDb} db Catapult db instance.
	 */
	constructor(db) {
		this.catapultDb = db;
	}

  // region raw namespace retrieval

	// Internal method: retrieve namespace by object ID.
  // Does not process internal _id.
	rawNamespaceByObjectId(collectionName, id) {
		const namespaceId = new ObjectId(id);
		const condition = { _id: { $eq: namespaceId } };
		return this.catapultDb.queryDocument(collectionName, condition);
	}

	// Internal method: retrieve namespace by namespace ID.
  // Does not process internal _id.
  rawNamespaceById(collectionName, id) {
		const namespaceId = new Long(id[0], id[1]);
		const conditions = { $or: [] };

		for (let level = 0; 3 > level; ++level) {
			const conjunction = createActiveConditions();
			conjunction.$and.push({ [`namespace.level${level}`]: namespaceId });
			conjunction.$and.push({ 'namespace.depth': level + 1 });

			conditions.$or.push(conjunction);
		}

		return this.catapultDb.queryDocument(collectionName, conditions);
	}

  // endregion

  // region well-known mosaic retrieval

	// Internal method: retrieve network currency mosaic.
	networkCurrencyMosaic() {
		const currencyId = uint64.fromHex('85bbea6cc462b244');
		return this.rawNamespaceById('namespaces', currencyId)
			.then(namespace => namespace.namespace.alias.mosaicId);
	}

	// Internal method: retrieve network harvest mosaic.
	networkHarvestMosaic() {
		const harvestId = uint64.fromHex('941299b2b7e1291c');
		return this.rawNamespaceById('namespaces', harvestId)
			.then(namespace => namespace.namespace.alias.mosaicId);
	}

  // endregion

  // region cursor namespace retrieval

	// Internal method to find sorted namespaces from query.
	sortedNamespaces(collectionName, condition, count) {
		// Sort by descending startHeight, then by descending ID.
		// Don't sort solely on ID, since it will break if 32-bit time wraps.
		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const sorting = { 'namespace.startHeight': -1, _id: -1 };
		return this.catapultDb.database.collection(collectionName)
      .find(condition)
      .sort(sorting)
      .limit(count)
      .toArray()
			.then(this.catapultDb.sanitizer.copyAndDeleteIds);
	}

	// Internal method to get namespaces up to (non-inclusive) the block height
	// and the namespace ID, returning at max `count` items.
	namespacesFrom(collectionName, height, id, count) {
		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const condition = { $or: [
			{ 'namespace.startHeight': { $eq: height }, _id: { $lt: id } },
			{ 'namespace.startHeight': { $lt: height } }
		]};

		return this.sortedNamespaces(collectionName, condition, count)
			.then(namespaces => Promise.resolve(namespaces));
	}

	// Internal method to get namespaces since (non-inclusive) the block height
	// and the namespace ID, returning at max `count` items.
	namespacesSince(collectionName, height, id, count) {
		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const condition = { $or: [
			{ 'namespace.startHeight': { $eq: height }, _id: { $gt: id } },
			{ 'namespace.startHeight': { $gt: height } }
		]};

		return this.sortedNamespaces(collectionName, condition, count)
			.then(namespaces => Promise.resolve(namespaces));
	}

	namespacesFromEarliest(...args) {
    return this.catapultDb.arrayFromEmpty();
	}

	namespacesSinceEarliest(...args) {
		const method = 'namespacesSince';
    const genArgs = () => [this.catapultDb.minLong(), this.catapultDb.minObjectId()];
    return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	namespacesFromLatest(...args) {
    const method = 'namespacesFrom';
    const genArgs = () => [this.catapultDb.maxLong(), this.catapultDb.maxObjectId()];
    return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	namespacesSinceLatest(...args) {
    return this.catapultDb.arrayFromEmpty();
	}

	namespacesFromNamespace(...args) {
		const method = 'namespacesFrom';
    const genArgs = (namespace) => [namespace.namespace.startHeight, namespace._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	namespacesSinceNamespace(...args) {
		const method = 'namespacesSince';
    const genArgs = (namespace) => [namespace.namespace.startHeight, namespace._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	namespacesFromId(...args) {
    return this.catapultDb.arrayFromId(this, 'namespacesFromNamespace', 'rawNamespaceById', ...args);
	}

	namespacesSinceId(...args) {
    return this.catapultDb.arrayFromId(this, 'namespacesSinceNamespace', 'rawNamespaceById', ...args);
	}

	namespacesFromObjectId(...args) {
    return this.catapultDb.arrayFromId(this, 'namespacesFromNamespace', 'rawNamespaceByObjectId', ...args);
	}

	namespacesSinceObjectId(...args) {
    return this.catapultDb.arrayFromId(this, 'namespacesSinceNamespace', 'rawNamespaceByObjectId', ...args);
	}

	// endregion

	// region account by namespace-linked mosaic retrieval

	addFieldMosaicBalance(mosaicId) {
		// Reduce over the account mosaics, and add the currency amount if
		// the mosaics match, otherwise, add 0.
		return {
			$reduce: {
				input: "$account.mosaics",
				initialValue: { $toLong: 0 },
				in: { $add : [
					"$$value",
					{
						$cond: {
							if: { $eq: [ "$$this.id", mosaicId ] },
							then: "$$this.amount",
							else: { $toLong: 0 }
						}
					}
				] }
			}
		}
	}

	// Internal method to find sort accounts by balance in a mosaic ID from query.
	sortedAccountsByMosaicBalance(collectionName, mosaicId, match, count) {
		const aggregation = [
			{ $addFields: {
				'account.importance': this.catapultDb.addFieldImportance(),
				'account.importanceHeight': this.catapultDb.addFieldImportanceHeight(),
				'account.balance': this.addFieldMosaicBalance(mosaicId),
			} },
			{ $match: match }
		];
		// Need secondary public key height and ID height to sort by when the
		// account's public key was known to network.
		const sorting = { 'account.balance': -1, 'account.publicKeyHeight': -1, _id: -1 };
		const projection = { 'account.importances': 0, 'account.balance': 0 };

		return this.catapultDb.database.collection(collectionName)
			.aggregate(aggregation, { promoteLongs: false })
			.sort(sorting)
			.project(projection)
			.limit(count)
			.toArray()
			.then(this.catapultDb.sanitizer.deleteIds);
	}

	// endregion

	// region cursor account by currency mosaic retrieval

	rawAccountWithCurrencyBalanceByAddress(collectionName, address) {
		return this.networkHarvestMosaic().then(mosaicId => {
			const addFields = { $addFields: {
				'account.importance': this.catapultDb.addFieldImportance(),
				'account.importanceHeight': this.catapultDb.addFieldImportanceHeight(),
				'account.balance': this.addFieldMosaicBalance(mosaicId)
			} };
			const projection = { 'account.importances': 0 };
			return this.catapultDb.rawAccountByAddress(collectionName, address, addFields, projection);
		});
	}

	rawAccountWithCurrencyBalanceByPublicKey(collectionName, publicKey) {
		const address = this.catapultDb.publicKeyToAddress(publicKey);
		return this.rawAccountWithCurrencyBalanceByAddress(collectionName, address);
	}

	sortedAccountsByCurrencyBalance(collectionName, match, count) {
		return this.networkCurrencyMosaic().then(mosaicId => {
			return this.sortedAccountsByMosaicBalance(collectionName, mosaicId, match, count);
		});
	}

	accountsByCurrencyBalanceFrom(collectionName, balance, height, id, numAccounts) {
		const match = this.catapultDb.accountMatchCondition('balance', '$lt', balance, height, id);
		return this.sortedAccountsByCurrencyBalance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByCurrencyBalanceSince(collectionName, balance, height, id, numAccounts) {
		const match = this.catapultDb.accountMatchCondition('balance', '$gt', balance, height, id);
		return this.sortedAccountsByCurrencyBalance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByCurrencyBalanceFromLeast(...args) {
		return this.catapultDb.arrayFromEmpty();
	}

	accountsByCurrencyBalanceSinceLeast(...args) {
		const method = 'accountsByCurrencyBalanceSince';
		const genArgs = () => [this.catapultDb.minLong(), this.catapultDb.minLong(), this.catapultDb.minObjectId()];
		return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByCurrencyBalanceFromMost(...args) {
		const method = 'accountsByCurrencyBalanceFrom';
		const genArgs = () => [this.catapultDb.maxLong(), this.catapultDb.maxLong(), this.catapultDb.maxObjectId()];
		return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByCurrencyBalanceSinceMost(...args) {
		return this.catapultDb.arrayFromEmpty();
	}

	accountsByCurrencyBalanceFromAccount(...args) {
		const method = 'accountsByCurrencyBalanceFrom';
    const genArgs = (account) => [account.account.balance, account.account.publicKeyHeight, account._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByCurrencyBalanceSinceAccount(...args) {
		const method = 'accountsByCurrencyBalanceFrom';
		const genArgs = (account) => [account.account.balance, account.account.publicKeyHeight, account._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByCurrencyBalanceFromAddress(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByCurrencyBalanceFromAccount', 'rawAccountWithCurrencyBalanceByAddress', ...args);
	}

	accountsByCurrencyBalanceSinceAddress(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByCurrencyBalanceSinceAccount', 'rawAccountWithCurrencyBalanceByAddress', ...args);
	}

	accountsByCurrencyBalanceFromPublicKey(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByCurrencyBalanceFromAccount', 'rawAccountWithCurrencyBalanceByPublicKey', ...args);
	}

	accountsByCurrencyBalanceSincePublicKey(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByCurrencyBalanceSinceAccount', 'rawAccountWithCurrencyBalanceByPublicKey', ...args);
	}

	// endregion

	// region cursor account by harvest mosaic retrieval

	rawAccountWithHarvestBalanceByAddress(collectionName, address) {
		return this.networkHarvestMosaic().then(mosaicId => {
			const addFields = { $addFields: {
				'account.importance': this.catapultDb.addFieldImportance(),
				'account.importanceHeight': this.catapultDb.addFieldImportanceHeight(),
				'account.balance': this.addFieldMosaicBalance(mosaicId)
			} };
			const projection = { 'account.importances': 0 };
			return this.catapultDb.rawAccountByAddress(collectionName, address, addFields, projection);
		});
	}

	rawAccountWithHarvestBalanceByPublicKey(collectionName, publicKey) {
		const address = this.catapultDb.publicKeyToAddress(publicKey);
		return this.rawAccountWithHarvestBalanceByAddress(collectionName, address);
	}

	sortedAccountsByHarvestBalance(collectionName, match, count) {
		return this.networkHarvestMosaic().then(mosaicId => {
			return this.sortedAccountsByMosaicBalance(collectionName, mosaicId, match, count);
		});
	}

	accountsByHarvestBalanceFrom(collectionName, balance, height, id, numAccounts) {
		const match = this.catapultDb.accountMatchCondition('balance', '$lt', balance, height, id);
		return this.sortedAccountsByHarvestBalance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByHarvestBalanceSince(collectionName, balance, height, id, numAccounts) {
		const match = this.catapultDb.accountMatchCondition('balance', '$gt', balance, height, id);
		return this.sortedAccountsByHarvestBalance(collectionName, match, numAccounts)
			.then(accounts => Promise.resolve(accounts));
	}

	accountsByHarvestBalanceFromLeast(...args) {
		return this.catapultDb.arrayFromEmpty();
	}

	accountsByHarvestBalanceSinceLeast(...args) {
		const method = 'accountsByHarvestBalanceSince';
		const genArgs = () => [this.catapultDb.minLong(), this.catapultDb.minLong(), this.catapultDb.minObjectId()];
		return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestBalanceFromMost(...args) {
		const method = 'accountsByHarvestBalanceFrom';
		const genArgs = () => [this.catapultDb.maxLong(), this.catapultDb.maxLong(), this.catapultDb.maxObjectId()];
		return this.catapultDb.arrayFromAbsolute(this, method, genArgs, ...args);
	}

	accountsByHarvestBalanceSinceMost(...args) {
		return this.catapultDb.arrayFromEmpty();
	}

	accountsByHarvestBalanceFromAccount(...args) {
		const method = 'accountsByHarvestBalanceFrom';
    const genArgs = (account) => [account.account.balance, account.account.publicKeyHeight, account._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestBalanceSinceAccount(...args) {
		const method = 'accountsByHarvestBalanceFrom';
		const genArgs = (account) => [account.account.balance, account.account.publicKeyHeight, account._id];
    return this.catapultDb.arrayFromRecord(this, method, genArgs, ...args);
	}

	accountsByHarvestBalanceFromAddress(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByHarvestBalanceFromAccount', 'rawAccountWithHarvestBalanceByAddress', ...args);
	}

	accountsByHarvestBalanceSinceAddress(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByHarvestBalanceSinceAccount', 'rawAccountWithHarvestBalanceByAddress', ...args);
	}

	accountsByHarvestBalanceFromPublicKey(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByHarvestBalanceFromAccount', 'rawAccountWithHarvestBalanceByPublicKey', ...args);
	}

	accountsByHarvestBalanceSincePublicKey(...args) {
		return this.catapultDb.arrayFromId(this, 'accountsByHarvestBalanceSinceAccount', 'rawAccountWithHarvestBalanceByPublicKey', ...args);
	}

	// endregion

	// region namespace retrieval

	/**
	 * Retrieves a namespace.
	 * @param {module:catapult.utils/uint64~uint64} id Namespace id.
	 * @returns {Promise.<object>} Namespace.
	 */
	namespaceById(collectionName, id) {
		return this.rawNamespaceById(collectionName, id)
			.then(this.catapultDb.sanitizer.copyAndDeleteId);
	}

	/**
	 * Retrieves namespaces owned by specified owners.
	 * @param {module:db/AccountType} type Type of account ids.
	 * @param {array<object>} accountIds Account ids.
	 * @param {string} id Paging id.
	 * @param {int} pageSize Page size.
	 * @param {object} options Additional options.
	 * @returns {Promise.<array>} Owned namespaces.
	 */
	namespacesByOwners(type, accountIds, id, pageSize, options) {
		const buffers = accountIds.map(accountId => Buffer.from(accountId));
		const conditions = createActiveConditions();
		const fieldName = (AccountType.publicKey === type) ? 'namespace.ownerPublicKey' : 'namespace.ownerAddress';
		conditions.$and.push({ [fieldName]: { $in: buffers } });

		return this.catapultDb.queryPagedDocuments('namespaces', conditions, id, pageSize, options)
			.then(this.catapultDb.sanitizer.copyAndDeleteIds);
	}

	/**
	 * Retrieves non expired namespaces aliasing mosaics or addresses.
	 * @param {Array.<module:catapult.model.namespace/aliasType>} aliasType Alias type.
	 * @param {*} ids Set of mosaic or address ids.
	 * @returns {Promise.<array>} Active namespaces aliasing ids.
	 */
	activeNamespacesWithAlias(aliasType, ids) {
		const aliasFilterCondition = {
			[catapult.model.namespace.aliasType.mosaic]: () => ({ 'namespace.alias.mosaicId': { $in: ids.map(convertToLong) } }),
			[catapult.model.namespace.aliasType.address]: () => ({ 'namespace.alias.address': { $in: ids.map(id => Buffer.from(id)) } })
		};

		return this.catapultDb.database.collection('blocks').countDocuments()
			.then(numBlocks => {
				const conditions = { $and: [] };
				conditions.$and.push(aliasFilterCondition[aliasType]());
				conditions.$and.push({ 'namespace.alias.type': aliasType });
				conditions.$and.push({
					$or: [
						{ 'namespace.endHeight': convertToLong(-1) },
						{ 'namespace.endHeight': { $gt: numBlocks } }]
				});

				return this.catapultDb.queryDocuments('namespaces', conditions);
			});
	}

	// endregion

	/**
	 * Retrieves transactions that registered the specified namespaces.
	 * @param {Array.<module:catapult.utils/uint64~uint64>} namespaceIds Namespace ids.
	 * @returns {Promise.<array>} Register namespace transactions.
	 */
	registerNamespaceTransactionsByNamespaceIds(namespaceIds) {
		const type = catapult.model.EntityType.registerNamespace;
		const conditions = { $and: [] };
		conditions.$and.push({ 'transaction.id': { $in: namespaceIds } });
		conditions.$and.push({ 'transaction.type': type });
		return this.catapultDb.queryDocuments('transactions', conditions);
	}
}

module.exports = NamespaceDb;
