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

const namespaceUtils = require('./namespaceUtils');
const dbUtils = require('../../db/dbUtils');
const routeUtils = require('../../routes/routeUtils');
const routeResultTypes = require('../../routes/routeResultTypes');
const errors = require('../../server/errors');
const AccountType = require('../AccountType');
const catapult = require('catapult-sdk');
const MongoDb = require('mongodb');

const { address, networkInfo } = catapult.model;
const { Binary } = MongoDb;
const { convertToLong } = dbUtils;
const { uint64 } = catapult.utils;

// Implied method to get namespaces from or since identifier.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
//	db - Database utility.
//	collectionName - Name of the collection to query.
//  countRange - Range of valid query counts.
// 	redirectUrl - Callback to get redirect URL.
//  duration - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getNamespaces = (req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType) => {
	const namespace = req.params.namespace;
  const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');

	if (!limit) {
		return res.redirect(redirectUrl(namespace, countRange.preset), next);
	}

  let dbMethod;
  let dbArgs;
	if (routeUtils.validateValue(namespace, 'earliest')) {
    dbMethod = 'namespaces' + duration + 'Earliest';
    dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(namespace, 'latest')) {
    dbMethod = 'namespaces' + duration + 'Latest';
    dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(namespace, 'namespaceId')) {
    const id = routeUtils.parseValue(namespace, 'namespaceId');
    dbMethod = 'namespaces' + duration + 'Id';
    dbArgs = [collectionName, id, limit];
  } else if (routeUtils.validateValue(namespace, 'objectId')) {
    const id = routeUtils.parseValue(namespace, 'objectId');
    dbMethod = 'namespaces' + duration + 'ObjectId';
    dbArgs = [collectionName, id, limit];
	} else {
    res.send(errors.createInvalidArgumentError('namespaceId has an invalid format'));
    return next();
	}

  routeUtils.queryAndSendDurationCollection(res, next, namespace, db, dbMethod, dbArgs, transformer, resultType);
}

// Implied method to get transactions from or since identifier.
//  req - Request data.
//   res - Response data.
//  next - Control flow callback.
//  db - Database utility.
//  collectionName - Name of the collection to query.
//   countRange - Range of valid query counts.
//   redirectUrl - Callback to get redirect URL.
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

// Implied method to get transactions filtered by type from or since identifier.
//  req - Request data.
//  res - Response data.
//  next - Control flow callback.
//  db - Database utility.
//  collectionName - Name of the collection to query.
//  countRange - Range of valid query counts.
//  redirectUrl - Callback to get redirect URL.
//  duration - 'From' or 'Since'.
//  transformer - Callback to transform each element.
//  resultType - Data result type (for formatting).
const getTransactionsByTypeWithFilter = (req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType) => {
  const transaction = req.params.transaction;
  const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');
  const type = routeUtils.parseArgument(req.params, 'type', 'transactionType');
  // req.params.type has already been white-listed, so this is safe.
  const filter = routeUtils.parseArgument(req.params, 'filter', req.params.type + 'FilterType');

  if (!limit) {
      return res.redirect(redirectUrl(transaction, req.params.type, countRange.preset), next);
  }

  let dbMethod;
  let dbArgs;
  if (routeUtils.validateValue(transaction, 'earliest')) {
      dbMethod = 'transactionsByTypeWithFilter' + duration + 'Earliest';
      dbArgs = [collectionName, type, filter, limit];
  } else if (routeUtils.validateValue(transaction, 'latest')) {
      dbMethod = 'transactionsByTypeWithFilter' + duration + 'Latest';
      dbArgs = [collectionName, type, filter, limit];
  } else if (routeUtils.validateValue(transaction, 'objectId')) {
      const id = routeUtils.parseValue(transaction, 'objectId');
      dbMethod = 'transactionsByTypeWithFilter' + duration + 'Id';
      dbArgs = [collectionName, id, type, filter, limit];
  } else if (routeUtils.validateValue(transaction, 'hash256')) {
      const hash = routeUtils.parseValue(transaction, 'hash256');
      dbMethod = 'transactionsByTypeWithFilter' + duration + 'Hash';
      dbArgs = [collectionName, hash, type, filter, limit];
  } else {
    res.send(errors.createInvalidArgumentError('transactionId has an invalid format'));
    return next();
  }

  routeUtils.queryAndSendDurationCollection(res, next, transaction, db, dbMethod, dbArgs, transformer, resultType);
}

module.exports = {
	register: (server, db, services) => {
    const countRange = services.config.countRange;
		const namespaceSender = routeUtils.createSender('namespaceDescriptor');

		server.get('/namespace/:namespaceId', (req, res, next) => {
			const namespaceId = routeUtils.parseArgument(req.params, 'namespaceId', uint64.fromHex);
			return db.namespaceById('namespaces', namespaceId)
				.then(namespaceSender.sendOne(req.params.namespaceId, res, next));
		});

		server.get('/account/:accountId/namespaces', (req, res, next) => {
			const [type, accountId] = routeUtils.parseArgument(req.params, 'accountId', 'accountId');
			const pagingOptions = routeUtils.parsePagingArguments(req.params);

			return db.namespacesByOwners(type, [accountId], pagingOptions.id, pagingOptions.pageSize)
				.then(namespaces => routeUtils.createSender('namespaces').sendOne('accountId', res, next)({ namespaces }));
		});

		server.post('/account/namespaces', (req, res, next) => {
			if (req.params.publicKeys && req.params.addresses)
				throw errors.createInvalidArgumentError('publicKeys and addresses cannot both be provided');

			const idOptions = Array.isArray(req.params.publicKeys)
				? { keyName: 'publicKeys', parserName: 'publicKey', type: AccountType.publicKey }
				: { keyName: 'addresses', parserName: 'address', type: AccountType.address };

			const accountIds = routeUtils.parseArgumentAsArray(req.params, idOptions.keyName, idOptions.parserName);
			const pagingOptions = routeUtils.parsePagingArguments(req.params);
			return db.namespacesByOwners(idOptions.type, accountIds, pagingOptions.id, pagingOptions.pageSize)
				.then(namespaces => routeUtils.createSender('namespaces').sendOne(idOptions.keyName, res, next)({ namespaces }));
		});

		const collectNames = (namespaceNameTuples, namespaceIds) => {
			const type = catapult.model.EntityType.registerNamespace;
			return db.catapultDb.findNamesByIds(namespaceIds, type, { id: 'id', name: 'name', parentId: 'parentId' })
				.then(nameTuples => {
					nameTuples.forEach(nameTuple => {
						// db returns null instead of undefined when parentId is not present
						if (null === nameTuple.parentId)
							delete nameTuple.parentId;

						namespaceNameTuples.push(nameTuple);
					});

					// process all parent namespaces next
					return nameTuples
						.filter(nameTuple => undefined !== nameTuple.parentId)
						.map(nameTuple => nameTuple.parentId);
				});
		};

		server.post('/namespace/names', (req, res, next) => {
			const namespaceIds = routeUtils.parseArgumentAsArray(req.params, 'namespaceIds', uint64.fromHex);
			const nameTuplesFuture = new Promise(resolve => {
				const namespaceNameTuples = [];
				const chain = nextIds => {
					if (0 === nextIds.length)
						resolve(namespaceNameTuples);
					else
						collectNames(namespaceNameTuples, nextIds).then(chain);
				};

				collectNames(namespaceNameTuples, namespaceIds).then(chain);
			});

			return nameTuplesFuture.then(routeUtils.createSender('namespaceNameTuple').sendArray('namespaceIds', res, next));
		});

		server.post('/mosaic/names', namespaceUtils.aliasNamesRoutesProcessor(
			db,
			catapult.model.namespace.aliasType.mosaic,
			req => routeUtils.parseArgumentAsArray(req.params, 'mosaicIds', uint64.fromHex).map(convertToLong),
			(namespace, id) => namespace.namespace.alias.mosaicId.equals(id),
			'mosaicId',
			'mosaicNames'
		));

		const accountIdToAddress = (type, accountId) => ((AccountType.publicKey === type)
			? address.publicKeyToAddress(accountId, networkInfo.networks[services.config.network.name].id)
			: accountId);

		const getParams = req => {
			if (req.params.publicKeys && req.params.addresses)
				throw errors.createInvalidArgumentError('publicKeys and addresses cannot both be provided');

			const idOptions = Array.isArray(req.params.publicKeys)
				? { keyName: 'publicKeys', parserName: 'publicKey', type: AccountType.publicKey }
				: { keyName: 'addresses', parserName: 'address', type: AccountType.address };

			const accountIds = routeUtils.parseArgumentAsArray(req.params, idOptions.keyName, idOptions.parserName);

			return accountIds.map(accountId => accountIdToAddress(idOptions.type, accountId));
		};

		server.post('/account/names', namespaceUtils.aliasNamesRoutesProcessor(
			db,
			catapult.model.namespace.aliasType.address,
			getParams,
			(namespace, id) => Buffer.from(namespace.namespace.alias.address.value())
				.equals(Buffer.from(new Binary(Buffer.from(id)).value())),
			'address',
			'accountNames'
		));

		// CURSORS - NAMESPACES

    // Gets namespace up to the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning up-to and including the latest namespace).
    //  - earliest (returning from the earliest namespace, IE, nothing).
    //  - A namespace ID.
    server.get('/namespaces/from/:namespace/limit/:limit', (req, res, next) => {
			const collectionName = 'namespaces';
      const redirectUrl = (namespace, limit) => `/namespaces/from/${namespace}/limit/${limit}`;
      const duration = 'From';
      const transformer = (info) => info;
			const resultType = 'namespaceDescriptor';
      return getNamespaces(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // Gets namespace since the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning since the latest namespace, IE, nothing).
    //  - earliest (returning since the earliest namespace).
    //  - A namespace ID.
    server.get('/namespaces/since/:namespace/limit/:limit', (req, res, next) => {
			const collectionName = 'namespaces';
      const redirectUrl = (namespace, limit) => `/namespaces/since/${namespace}/limit/${limit}`;
      const duration = 'Since';
      const transformer = (info) => info;
			const resultType = 'namespaceDescriptor';
      return getNamespaces(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
	  server.get('/namespaces/from/:namespace/limit/:limit/id', (req, res, next) => {
			const collectionName = 'namespaces';
      const redirectUrl = (namespace, limit) => `/namespaces/from/${namespace}/limit/${limit}/id`;
      const duration = 'From';
      const transformer = (info) => { return { id: info.meta.id }; };
			const resultType = 'namespaceId';
      return getNamespaces(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/namespaces/since/:namespace/limit/:limit/id', (req, res, next) => {
			const collectionName = 'namespaces';
      const redirectUrl = (namespace, limit) => `/namespaces/since/${namespace}/limit/${limit}/id`;
      const duration = 'Since';
      const transformer = (info) => { return { id: info.meta.id }; };
			const resultType = 'namespaceId';
      return getNamespaces(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // CURSORS - ACCOUNTS BY CURRENCY BALANCE

    // Gets accounts by currency balance up to the identifier (non-inclusive).
    // The identifier may be:
    //  - most (returning up-to and including the account with the most currency balance).
    //  - least (returning from the account with the least currency balance, IE, nothing).
    //  - An account address (base32 or hex-encoded).
    //  - An account public key (hex-encoded).
    server.get('/accounts/balance/currency/from/:account/limit/:limit', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/currency/from/${account}/limit/${limit}`;
      const sortType = 'ByCurrencyBalance';
      const duration = 'From';
      const transformer = (info) => info;
      const resultType = routeResultTypes.account;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // Gets accounts by currency balance since the identifier (non-inclusive).
    // The identifier may be:
    //  - most (returning since the account with the most currency balance, IE, nothing).
    //  - least (returning since the account with the least currency balance).
    //  - An account address (base32 or hex-encoded).
    //  - An account public key (hex-encoded).
    server.get('/accounts/balance/currency/since/:account/limit/:limit', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/currency/since/${account}/limit/${limit}`;
      const sortType = 'ByCurrencyBalance';
      const duration = 'Since';
      const transformer = (info) => info;
      const resultType = routeResultTypes.account;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/accounts/balance/currency/from/:account/limit/:limit/address', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/currency/from/${account}/limit/${limit}/address`;
      const sortType = 'ByCurrencyBalance';
      const duration = 'From';
      const transformer = (info) => { return { address: info.account.address }; };
      const resultType = routeResultTypes.accountAddress;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/accounts/balance/currency/since/:account/limit/:limit/address', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/currency/since/${account}/limit/${limit}/address`;
      const sortType = 'ByCurrencyBalance';
      const duration = 'Since';
      const transformer = (info) => { return { address: info.account.address }; };
      const resultType = routeResultTypes.accountAddress;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // CURSORS - ACCOUNTS BY HARVEST BALANCE

    // Gets accounts by harvest balance up to the identifier (non-inclusive).
    // The identifier may be:
    //  - most (returning up-to and including the account with the most harvest balance).
    //  - least (returning from the account with the least harvest balance, IE, nothing).
    //  - An account address (base32 or hex-encoded).
    //  - An account public key (hex-encoded).
    server.get('/accounts/balance/harvest/from/:account/limit/:limit', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/harvest/from/${account}/limit/${limit}`;
      const sortType = 'ByHarvestBalance';
      const duration = 'From';
      const transformer = (info) => info;
      const resultType = routeResultTypes.account;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // Gets accounts by harvest balance since the identifier (non-inclusive).
    // The identifier may be:
    //  - most (returning since the account with the most harvest balance, IE, nothing).
    //  - least (returning since the account with the least harvest balance).
    //  - An account address (base32 or hex-encoded).
    //  - An account public key (hex-encoded).
    server.get('/accounts/balance/harvest/since/:account/limit/:limit', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/harvest/since/${account}/limit/${limit}`;
      const sortType = 'ByHarvestBalance';
      const duration = 'Since';
      const transformer = (info) => info;
      const resultType = routeResultTypes.account;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/accounts/balance/harvest/from/:account/limit/:limit/address', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/harvest/from/${account}/limit/${limit}/address`;
      const sortType = 'ByHarvestBalance';
      const duration = 'From';
      const transformer = (info) => { return { address: info.account.address }; };
      const resultType = routeResultTypes.accountAddress;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/accounts/balance/harvest/since/:account/limit/:limit/address', (req, res, next) => {
      const collectionName = 'accounts';
      const redirectUrl = (account, limit) => `/accounts/balance/harvest/since/${account}/limit/${limit}/address`;
      const sortType = 'ByHarvestBalance';
      const duration = 'Since';
      const transformer = (info) => { return { address: info.account.address }; };
      const resultType = routeResultTypes.accountAddress;
      return getAccounts(req, res, next, db, collectionName, countRange, redirectUrl, sortType, duration, transformer, resultType);
    });

    // CURSORS -- CONFIRMED TRANSACTIONS BY TYPE WITH FILTER

    // Gets transactions filtered by type and a subfilter up to the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning up-to and including the latest transaction).
    //  - earliest (returning from the earliest transaction, IE, nothing).
    //  - A transaction hash.
    //  - A transaction ID.
    server.get('/transactions/from/:transaction/type/:type/filter/:filter/limit/:limit', (req, res, next) => {
      const collectionName = 'transactions';
      const redirectUrl = (transaction, type, filter, limit) => `/transactions/from/${transaction}/type/${type}/filter/${filter}/limit/${limit}`;
      const duration = 'From';
      const transformer = (info) => info;
      const resultType = routeResultTypes.transaction;
      return getTransactionsByTypeWithFilter(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // Gets transactions filtered by type and a subfilter since the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning since the latest transaction, IE, nothing).
    //  - earliest (returning since the earliest transaction).
    //  - A transaction hash.
    //  - A transaction ID.
    server.get('/transactions/since/:transaction/type/:type/filter/:filter/limit/:limit', (req, res, next) => {
      const collectionName = 'transactions';
      const redirectUrl = (transaction, type, filter, limit) => `/transactions/since/${transaction}/type/${type}/filter/${filter}/limit/${limit}`;
      const duration = 'Since';
      const transformer = (info) => info;
      const resultType = routeResultTypes.transaction;
      return getTransactionsByTypeWithFilter(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/transactions/from/:transaction/type/:type/filter/:filter/limit/:limit/hash', (req, res, next) => {
      const collectionName = 'transactions';
      const redirectUrl = (transaction, type, limit) => `/transactions/from/${transaction}/type/${type}/filter/${filter}/limit/${limit}/hash`;
      const duration = 'From';
      const transformer = (info) => { return { hash: info.meta.hash }; };
      const resultType = routeResultTypes.transactionHash;
      return getTransactionsByTypeWithFilter(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/transactions/since/:transaction/type/:type/filter/:filter/limit/:limit/hash', (req, res, next) => {
      const collectionName = 'transactions';
      const redirectUrl = (transaction, type, limit) => `/transactions/since/${transaction}/type/${type}/filter/${filter}/limit/${limit}/hash`;
      const duration = 'Since';
      const transformer = (info) => { return { hash: info.meta.hash }; };
      const resultType = routeResultTypes.transactionHash;
      return getTransactionsByTypeWithFilter(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });
	}
};
