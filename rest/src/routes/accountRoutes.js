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

const routeResultTypes = require('./routeResultTypes');
const routeUtils = require('./routeUtils');
const AccountType = require('../plugins/AccountType');
const errors = require('../server/errors');
const catapult = require('catapult-sdk');

const { address, networkInfo } = catapult.model;

// Implied method to get transactions from or since identifier.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
//	db - Database utility.
//	collectionName - Name of the collection to query.
// 	countRange - Range of valid query counts.
// 	redirectUrl - Callback to get redirect URL.
//  sortType - Keyword for the sorted type.
//  duration - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getAccounts = (req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType) => {
	const account = req.params.account;
	const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');

	if (!limit) {
		return res.redirect(redirectUrl(account, countRange.preset), next);
	}

	let dbMethod;
	let dbArgs;
	if (routeUtils.validateValue(account, 'least')) {
		dbMethod = 'accounts' + sortType + duration + 'Least';
		dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(account, 'most')) {
		dbMethod = 'accounts' + sortType + duration + 'Most';
		dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(account, 'address')) {
		const address = routeUtils.parseValue(account, 'address');
		dbMethod = 'accounts' + sortType + duration + 'Address';
		dbArgs = [collectionName, address, limit];
	} else if (routeUtils.validateValue(account, 'publicKey')) {
		const publicKey = routeUtils.parseValue(account, 'publicKey');
		dbMethod = 'accounts' + sortType + duration + 'PublicKey';
		dbArgs = [collectionName, publicKey, limit];
	} else {
		res.send(errors.createInvalidArgumentError('accountId has an invalid format'));
    return next();
	}

	routeUtils.queryAndSendDurationCollection(res, next, account, db, dbMethod, dbArgs, transformer, resultType);
}

module.exports = {
	register: (server, db, services) => {
		const countRange = services.config.countRange;
		const transactionSender = routeUtils.createSender(routeResultTypes.transaction);

		server.get('/account/:accountId', (req, res, next) => {
			const [type, accountId] = routeUtils.parseArgument(req.params, 'accountId', 'accountId');
			const sender = routeUtils.createSender(routeResultTypes.account);
			return db.accountsByIds([{ [type]: accountId }])
				.then(sender.sendOne(req.params.accountId, res, next));
		});

		server.post('/account', (req, res, next) => {
			if (req.params.publicKeys && req.params.addresses)
				throw errors.createInvalidArgumentError('publicKeys and addresses cannot both be provided');

			const idOptions = Array.isArray(req.params.publicKeys)
				? { keyName: 'publicKeys', parserName: 'publicKey', type: AccountType.publicKey }
				: { keyName: 'addresses', parserName: 'address', type: AccountType.address };

			const accountIds = routeUtils.parseArgumentAsArray(req.params, idOptions.keyName, idOptions.parserName);
			const sender = routeUtils.createSender(routeResultTypes.account);

			return db.accountsByIds(accountIds.map(accountId => ({ [idOptions.type]: accountId })))
				.then(sender.sendArray(idOptions.keyName, res, next));
		});

		// region account transactions

		const transactionStates = [
			{ dbPostfix: 'All', routePostfix: '' },
			{ dbPostfix: 'Outgoing', routePostfix: '/outgoing' },
			{ dbPostfix: 'Unconfirmed', routePostfix: '/unconfirmed' }
		];

		const accountIdToPublicKey = (type, accountId) => {
			if (AccountType.publicKey === type)
				return Promise.resolve(accountId);

			return routeUtils.addressToPublicKey(db, accountId);
		};

		transactionStates.concat(services.config.transactionStates).forEach(state => {
			server.get(`/account/:accountId/transactions${state.routePostfix}`, (req, res, next) => {
				const [type, accountId] = routeUtils.parseArgument(req.params, 'accountId', 'accountId');
				const pagingOptions = routeUtils.parsePagingArguments(req.params);
				const ordering = routeUtils.parseArgument(req.params, 'ordering', input => ('id' === input ? 1 : -1));

				return accountIdToPublicKey(type, accountId).then(publicKey =>
					db[`accountTransactions${state.dbPostfix}`](publicKey, pagingOptions.id, pagingOptions.pageSize, ordering)
						.then(transactionSender.sendArray('accountId', res, next)));
			});
		});

		server.get('/account/:accountId/transactions/incoming', (req, res, next) => {
			const [type, accountId] = routeUtils.parseArgument(req.params, 'accountId', 'accountId');
			const pagingOptions = routeUtils.parsePagingArguments(req.params);
			const ordering = routeUtils.parseArgument(req.params, 'ordering', input => ('id' === input ? 1 : -1));

			const accountAddress = (AccountType.publicKey === type)
				? address.publicKeyToAddress(accountId, networkInfo.networks[services.config.network.name].id)
				: accountId;

			return db.accountTransactionsIncoming(accountAddress, pagingOptions.id, pagingOptions.pageSize, ordering)
				.then(transactionSender.sendArray('accountId', res, next));
		});

		// endregion
		// Debug method. TODO(ahuszagh) Remove.
		server.get('/accounts/testing', (req, res, next) => {
			db.sortedAccountsByBalance('accounts', {}, 25).then(accounts => {
				console.log(accounts);
				res.send({ payload: accounts, type: routeResultTypes.account });
				next();
			});
		// CURSORS - ACCOUNTS BY IMPORTANCE

		// Gets accounts by importance up to the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning up-to and including the account with the most importance).
		//  - least (returning from the account with the least importance, IE, nothing).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/importance/from/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/importance/from/${account}/limit/${limit}`;
			const sortType = 'ByImportance';
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// Gets accounts by importance since the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning since the account with the most importance, IE, nothing).
		//  - least (returning since the account with the least importance).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/importance/since/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/importance/since/${account}/limit/${limit}`;
			const sortType = 'ByImportance';
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/importance/from/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/importance/from/${account}/limit/${limit}/address`;
			const sortType = 'ByImportance';
			const duration = 'From';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/importance/since/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/importance/since/${account}/limit/${limit}/address`;
			const sortType = 'ByImportance';
			const duration = 'Since';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// CURSORS - ACCOUNTS BY HARVESTED BLOCKS

		// Gets accounts by harvested blocks up to the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning up-to and including the account with the most harvested blocks).
		//  - least (returning from the account with the least harvested blocks, IE, nothing).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/harvested/blocks/from/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/blocks/from/${account}/limit/${limit}`;
			const sortType = 'ByHarvestedBlocks';
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// Gets accounts by harvested blocks since the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning since the account with the most harvested blocks, IE, nothing).
		//  - least (returning since the account with the least harvested blocks).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/harvested/blocks/since/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/blocks/since/${account}/limit/${limit}`;
			const sortType = 'ByHarvestedBlocks';
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/harvested/blocks/from/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/blocks/from/${account}/limit/${limit}/address`;
			const sortType = 'ByHarvestedBlocks';
			const duration = 'From';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/harvested/blocks/since/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/blocks/since/${account}/limit/${limit}/address`;
			const sortType = 'ByHarvestedBlocks';
			const duration = 'Since';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// CURSORS - ACCOUNTS BY HARVESTED FEES

		// Gets accounts by harvested fees up to the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning up-to and including the account with the most harvested fees).
		//  - least (returning from the account with the least harvested fees, IE, nothing).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/harvested/fees/from/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/fees/from/${account}/limit/${limit}`;
			const sortType = 'ByHarvestedFees';
			const duration = 'From';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// Gets accounts by harvested fees since the identifier (non-inclusive).
		// The identifier may be:
		//  - most (returning since the account with the most harvested fees, IE, nothing).
		//  - least (returning since the account with the least harvested fees).
		//  - An account address (base32 or hex-encoded).
		//  - An account public key (hex-encoded).
		server.get('/accounts/harvested/fees/since/:account/limit/:limit', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/fees/since/${account}/limit/${limit}`;
			const sortType = 'ByHarvestedFees';
			const duration = 'Since';
			const transformer = (info) => info;
			const resultType = routeResultTypes.account;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/harvested/fees/from/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/fees/from/${account}/limit/${limit}/address`;
			const sortType = 'ByHarvestedFees';
			const duration = 'From';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
		});

		// TODO(ahuszagh) Debug method. Remove later.
		server.get('/accounts/harvested/fees/since/:account/limit/:limit/address', (req, res, next) => {
			const collectionName = 'accounts';
			const redirectUrl = (account, limit) => `/accounts/harvested/fees/since/${account}/limit/${limit}/address`;
			const sortType = 'ByHarvestedFees';
			const duration = 'Since';
			const transformer = (info) => { return { address: info.account.address }; };
			const resultType = routeResultTypes.accountAddress;
			return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
>>>>>>> Added basic account methods, DB queries, and simplified the query API.
		});
	}
};
