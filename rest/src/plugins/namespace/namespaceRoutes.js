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
const errors = require('../../server/errors');
const AccountType = require('../AccountType');
const catapult = require('catapult-sdk');
const MongoDb = require('mongodb');

const { address, networkInfo } = catapult.model;
const { Binary } = MongoDb;
const { convertToLong } = dbUtils;
const { uint64 } = catapult.utils;

const getLimit = (validLimits, params) => {
	const limit = routeUtils.parseArgument(params, 'limit', 'uint');
	return -1 === validLimits.indexOf(limit) ? undefined : limit;
};

// Parse object ID from string.
const parseObjectId = str => {
	if (!convert.isHexString(str))
		throw Error('must be 12-byte hex string');

	return str;
};

// Implied method to get namespacess from or since identifier.
//	req - Request data.
// 	res - Response data.
//	next - Control flow callback.
// 	pageSizes - Array of valid page sizes.
// 	redirectUrl - Callback to get redirect URL.
//  direction - 'From' or 'Since'.
//  transformer - Callback to transform each element.
const getNamespaces = (req, res, next, db, pageSizes, redirectUrl, direction, transformer) => {
	const namespace = req.params.namespace;
	const limit = getLimit(pageSizes, req.params);
	const collectionName = 'namespaces';

	if (!limit) {
		return res.redirect(redirectUrl(transaction, pageSizes[0]), next);
	}

	if ('earliest' === namespace) {
		db['namespaces' + direction + 'Earliest'](collectionName, limit).then(namespaces => {
			const data = namespaces.map(transformer);
			res.send({ payload: data });
			next();
		});
	} else if ('latest' === namespace) {
		db['namespaces' + direction + 'Latest'](collectionName, limit).then(namespaces => {
			const data = namespaces.map(transformer);
			res.send({ payload: data });
			next();
		});
	} else if (constants.sizes.objectId === namespace.length) {
		const id = parseObjectId(namespace);
		db['namespaces' + direction + 'Id'](collectionName, id, limit).then(namespaces => {
			const data = namespaces.map(transformer);
			res.send({ payload: data });
			next();
		});
	} else {
		throw new Error(`invalid length of namespace id '${transaction}'`)
	}
}

module.exports = {
	register: (server, db, services) => {
		const validPageSizes = routeUtils.generateValidPageSizes(services.config.pageSize); // throws if there is not at least one valid page size
		const namespaceSender = routeUtils.createSender('namespaceDescriptor');

		server.get('/namespace/:namespaceId', (req, res, next) => {
			const namespaceId = routeUtils.parseArgument(req.params, 'namespaceId', uint64.fromHex);
			return db.namespaceById(namespaceId)
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

		// CURSORS

    // Gets namespace up to the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning up-to and including the latest namespace).
    //  - earliest (returning from the earliest namespace, IE, nothing).
    //  - A namespace ID.
    server.get('/namespaces/from/:namespace/limit/:limit', (req, res, next) => {
        const redirectUrl = (namespace, pageSize) => `/namespaces/from/${namespace}/limit/${pageSize}`;
        const direction = 'From';
        const transformer = (info) => info;
        return getNamespaces(req, res, next, db, validPageSizes, redirectUrl, direction, transformer);
    });

    // Gets namespace since the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning since the latest namespace, IE, nothing).
    //  - earliest (returning since the earliest namespace).
    //  - A namespace ID.
    server.get('/namespaces/since/:namespace/limit/:limit', (req, res, next) => {
        const redirectUrl = (namespace, pageSize) => `/namespaces/since/${namespace}/limit/${pageSize}`;
        const direction = 'Since';
        const transformer = (info) => info;
        return getNamespaces(req, res, next, db, validPageSizes, redirectUrl, direction, transformer);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/namespaces/from/:namespace/limit/:limit/id', (req, res, next) => {
        const redirectUrl = (namespace, pageSize) => `/namespaces/from/${namespace}/limit/${pageSize}/id`;
        const direction = 'From';
        const transformer = (info) => { return { id: info.meta.id }; };
        return getNamespaces(req, res, next, db, validPageSizes, redirectUrl, direction, transformer);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/namespaces/since/:namespace/limit/:limit/id', (req, res, next) => {
        const redirectUrl = (namespace, pageSize) => `/namespaces/since/${namespace}/limit/${pageSize}/id`;
        const direction = 'Since';
        const transformer = (info) => { return { id: info.meta.id }; };
        return getNamespaces(req, res, next, db, validPageSizes, redirectUrl, direction, transformer);
    });
	}
};
