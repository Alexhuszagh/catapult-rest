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

const routeUtils = require('../../routes/routeUtils');
const errors = require('../../server/errors');
const AccountType = require('../AccountType');
const catapult = require('catapult-sdk');

const { uint64 } = catapult.utils;

// Implied method to get mosaics from or since identifier.
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
const getMosaics = (req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType) => {
	const mosaic = req.params.mosaic;
  const limit = routeUtils.parseRangeArgument(req.params, 'limit', countRange, 'uint');

	if (!limit) {
		return res.redirect(redirectUrl(transaction, countRange.preset), next);
	}

	let dbMethod;
  let dbArgs;
	if (routeUtils.validateValue(mosaic, 'earliest')) {
    dbMethod = 'mosaics' + duration + 'Earliest';
    dbArgs = [collectionName, limit];
	} else if (routeUtils.validateValue(mosaic, 'latest')) {
    dbArgs = [collectionName, limit];
    dbMethod = 'mosaics' + duration + 'Latest';
	} else if (routeUtils.validateValue(namespace, 'mosaicId')) {
    const id = routeUtils.parseValue(namespace, 'mosaicId');
    dbMethod = 'mosaics' + duration + 'Id';
    dbArgs = [collectionName, id, limit];
  } else {
		throw new Error(`invalid length of mosaic id '${mosaic}'`)
	}

  routeUtils.queryAndSendDurationCollection(res, next, db, dbMethod, dbArgs, transformer, resultType);
}

module.exports = {
	register: (server, db, services) => {
    const countRange = services.config.countRange;
		const mosaicSender = routeUtils.createSender('mosaicDescriptor');

		routeUtils.addGetPostDocumentRoutes(
			server,
			mosaicSender,
			{ base: '/mosaic', singular: 'mosaicId', plural: 'mosaicIds' },
			params => db.mosaicsByIds(params),
			uint64.fromHex
		);

		const ownedMosaicsSender = routeUtils.createSender('ownedMosaics');

		server.get('/account/:accountId/mosaics', (req, res, next) => {
			const [type, accountId] = routeUtils.parseArgument(req.params, 'accountId', 'accountId');

			return db.mosaicsByOwners(type, [accountId])
				.then(mosaics => ownedMosaicsSender.sendOne('accountId', res, next)({ mosaics }));
		});

		server.post('/account/mosaics', (req, res, next) => {
			if (req.params.publicKeys && req.params.addresses)
				throw errors.createInvalidArgumentError('publicKeys and addresses cannot both be provided');

			const idOptions = Array.isArray(req.params.publicKeys)
				? { keyName: 'publicKeys', parserName: 'publicKey', type: AccountType.publicKey }
				: { keyName: 'addresses', parserName: 'address', type: AccountType.address };

			const accountIds = routeUtils.parseArgumentAsArray(req.params, idOptions.keyName, idOptions.parserName);
			return db.mosaicsByOwners(idOptions.type, accountIds)
				.then(mosaics => ownedMosaicsSender.sendOne(idOptions.keyName, res, next)({ mosaics }));
		});
		// CURSOR

    // Gets mosaic up to the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning up-to and including the latest mosaic).
    //  - earliest (returning from the earliest mosaic, IE, nothing).
    //  - A mosaic ID.
    server.get('/mosaics/from/:mosaic/limit/:limit', (req, res, next) => {
      const collectionName = 'mosaics';
      const redirectUrl = (mosaic, pageSize) => `/mosaics/from/${mosaic}/limit/${pageSize}`;
      const duration = 'From';
      const transformer = (info) => info;
      const resultType = 'mosaicDescriptor';
      return getMosaics(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // Gets mosaic since the identifier (non-inclusive).
    // The identifier may be:
    //  - latest (returning since the latest mosaic, IE, nothing).
    //  - earliest (returning since the earliest mosaic).
    //  - A mosaic ID.
    server.get('/mosaics/since/:mosaic/limit/:limit', (req, res, next) => {
      const collectionName = 'mosaics';
      const redirectUrl = (mosaic, pageSize) => `/mosaics/since/${mosaic}/limit/${pageSize}`;
      const duration = 'Since';
      const transformer = (info) => info;
      const resultType = 'mosaicDescriptor';
      return getMosaics(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/mosaics/from/:mosaic/limit/:limit/id', (req, res, next) => {
      const collectionName = 'mosaics';
      const redirectUrl = (mosaic, pageSize) => `/mosaics/from/${mosaic}/limit/${pageSize}/id`;
      const duration = 'From';
      const transformer = (info) => { return { id: info.mosaic.id }; };
      const resultType = 'mosaicId';
      return getMosaics(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });

    // TODO(ahuszagh) Debug method. Remove later.
    server.get('/mosaics/since/:mosaic/limit/:limit/id', (req, res, next) => {
      const collectionName = 'mosaics';
      const redirectUrl = (mosaic, pageSize) => `/mosaics/since/${mosaic}/limit/${pageSize}/id`;
      const duration = 'Since';
      const transformer = (info) => { return { id: info.mosaic.id }; };
      const resultType = 'mosaicId';
      return getMosaics(req, res, next, db, collectionName, countRange, redirectUrl, duration, transformer, resultType);
    });
	}
};
