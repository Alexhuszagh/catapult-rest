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

const AccountType = require('../AccountType');
const { convertToLong } = require('../../db/dbUtils');
const MongoDb = require('mongodb');

const { Long, ObjectId } = MongoDb;

class MosaicDb {
	/**
	 * Creates MosaicDb around CatapultDb.
	 * @param {module:db/CatapultDb} db Catapult db instance.
	 */
	constructor(db) {
		this.catapultDb = db;
	}

	// Internal method to find sorted mosaics from query.
	sortedMosaics(collectionName, condition, count) {
		// Sort by descending startHeight, then by descending ID.
		// Don't sort solely on ID, since it will break if 32-bit time wraps.
		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const sorting = { 'mosaic.startHeight': -1, _id: -1 };
    return this.catapultDb.database.collection(collectionName)
      .find(condition)
      .sort(sorting)
      .limit(count)
      .toArray()
			.then(this.catapultDb.sanitizer.deleteIds);
	}

	// Internal method to get mosaics up to (non-inclusive) the block height
	// and the mosaic ID, returning at max `numMosaics` items.
	mosaicsFromHeightAndId(collectionName, height, id, numMosaics) {
		if (0 === numMosaics)
			return Promise.resolve([]);

		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const condition = { $or: [
			{ 'mosaic.startHeight': { $eq: height }, _id: { $lt: id } },
			{ 'mosaic.startHeight': { $lt: height } }
		]};

		return this.sortedMosaics(collectionName, condition, numMosaics)
			.then(mosaics => Promise.resolve(mosaics));
	}

	// Internal method to get mosaics since (non-inclusive) the block height
	// and the mosaic ID, returning at max `numMosaics` items.
	mosaicsSinceHeightAndId(collectionName, height, id, numMosaics) {
		if (0 === numMosaics)
			return Promise.resolve([]);

		// TODO(ahuszagh)
		//	WARNING: startHeight is not indexed: this must be fixed in production.
		const condition = { $or: [
			{ 'mosaic.startHeight': { $eq: height }, _id: { $gt: id } },
			{ 'mosaic.startHeight': { $gt: height } }
		]};

		return this.sortedMosaics(collectionName, condition, numMosaics)
			.then(mosaics => Promise.resolve(mosaics));
	}

	// region mosaic retrieval

  // Dummy method, to provide all mosaics from (not-including) the earliest.
  // Always empty.
  mosaicsFromEarliest(collectionName, numMosaics) {
    return Promise.resolve([]);
  }

  // Get the earliest N mosaics since (and including) the earliest mosaic.
  mosaicsSinceEarliest(collectionName, numMosaics) {
    if (0 === numMosaics)
	    return Promise.resolve([]);

    const height = convertToLong(0);
		const id = new ObjectId('000000000000000000000000');
    return this.mosaicsSinceHeightAndId(collectionName, height, id, numMosaics);
  }

  // Get the latest N mosaics from (and including) the latest mosaic.
  mosaicsFromLatest(collectionName, numMosaics) {
    if (0 === numMosaics)
      return Promise.resolve([]);

    return this.catapultDb.chainStatisticCurrent().then(chainStatistic => {
      const one = convertToLong(1);
      const height = chainStatistic.height.add(one);
			const id = new ObjectId('000000000000000000000000');
      return this.mosaicsFromHeightAndId(collectionName, height, id, numMosaics);
    });
  }

  // Dummy method, to provide all mosaics since (not-including) the latest.
  // Always empty.
  mosaicsSinceLatest(collectionName, numMosaics) {
    return Promise.resolve([]);
  }

  // Get mosaics up to (non-inclusive) a mosaic object.
  mosaicsFromMosaic(collectionName, mosaic, numMosaics) {
    if (undefined === mosaic)
      return undefined;
    const height = mosaic.mosaic.startHeight;
    const id = mosaic._id;
    return this.mosaicsFromHeightAndId(collectionName, height, id, numMosaics);
  }

  // Get mosaics since (non-inclusive) a mosaic object.
  mosaicsSinceMosaic(collectionName, mosaic, numMosaics) {
    if (undefined === mosaic)
      return undefined;
    const height = mosaic.mosaic.startHeight;
    const id = mosaic._id;
    return this.mosaicsSinceHeightAndId(collectionName, height, id, numMosaics);
  }

  // Get mosaics up to (non-inclusive) the mosaic at id.
  mosaicsFromId(collectionName, id, numMosaics) {
    return this.mosaicById(collectionName, id).then(mosaic => {
      return this.mosaicsFromMosaic(collectionName, mosaic, numMosaics);
    });
  }

  // Get mosaics since (non-inclusive) the mosaic at id.
  mosaicsSinceId(collectionName, id, numMosaics) {
    return this.mosaicById(collectionName, id).then(mosaic => {
      return this.mosaicsSinceMosaic(collectionName, mosaic, numMosaics);
    });
  }

  // Internal method: Retrieve mosaic by ID.
  // Leaves an extraneous _id.
  mosaicById(collectionName, id) {
		const mosaicId = new Long(id[0], id[1]);
		const condition = { 'mosaic.id': { $eq: mosaicId } };
		return this.catapultDb.queryDocument(collectionName, condition);
  }

	/**
	 * Retrieves mosaics.
	 * @param {Array.<module:catapult.utils/uint64~uint64>} ids Mosaic ids.
	 * @returns {Promise.<array>} Mosaics.
	 */
	mosaicsByIds(ids) {
		const mosaicIds = ids.map(id => new Long(id[0], id[1]));
		const conditions = { 'mosaic.id': { $in: mosaicIds } };
		const collection = this.catapultDb.database.collection('mosaics');
		return collection.find(conditions)
			.sort({ _id: -1 })
			.toArray()
			.then(entities => Promise.resolve(this.catapultDb.sanitizer.deleteIds(entities)));
	}

	/**
	 * Retrieves mosaics owned by specified owners.
	 * @param {module:db/AccountType} type Type of account ids.
	 * @param {array<object>} accountIds Account ids.
	 * @returns {Promise.<array>} Owned mosaics.
	 */
	mosaicsByOwners(type, accountIds) {
		const buffers = accountIds.map(accountId => Buffer.from(accountId));
		const fieldName = (AccountType.publicKey === type) ? 'mosaic.ownerPublicKey' : 'mosaic.ownerAddress';
		const conditions = { [fieldName]: { $in: buffers } };

		return this.catapultDb.queryDocuments('mosaics', conditions)
			.then(mosaics => mosaics.map(mosaic => mosaic.mosaic));
	}

	// endregion
}

module.exports = MosaicDb;
