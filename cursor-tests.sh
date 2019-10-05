#!/bin/bash

# Tests to ensure the cursor functionality works as planned.
# This tests every permutation of the the cursors, for the following
# routes:
#
#   Block Routes:
#       /blocks/from/:height/limit/:limit
#       /blocks/since/:height/limit/:limit
#
#   Transaction Routes:
#       /transactions/from/:transaction/limit/:limit
#       /transactions/since/:transaction/limit/:limit
#       /transactions/from/:transaction/type/:type/limit/:limit
#       /transactions/since/:transaction/type/:type/limit/:limit
#       /transactions/unconfirmed/from/:transaction/limit/:limit
#       /transactions/unconfirmed/since/:transaction/limit/:limit
#       /transactions/partial/from/:transaction/limit/:limit
#       /transactions/partial/since/:transaction/limit/:limit
#
#   Mosaic Routes:
#       /mosaics/from/:mosaic/limit/:limit
#       /mosaics/since/:mosaic/limit/:limit
#
#   Namespace Routes:
#       /namespaces/from/:namespace/limit/:limit
#       /namespaces/since/:namespace/limit/:limit
#
#   Account Routes:
#       /accounts/importance/from/:account/limit/:limit
#       /accounts/harvested/blocks/from/:account/limit/:limit
#       /accounts/harvested/fees/from/:account/limit/:limit
#       /accounts/balance/currency/from/:account/limit/:limit
#       /accounts/balance/harvest/from/:account/limit/:limit

set -ex

host=localhost:3000
limit=25

# KEYWORDS

durations=(
    "from"
    "since"
)

absolute_modifiers=(
    "max"
    "min"
)

time_modifers=(
    "${absolute_modifiers[@]}"
    "latest"
    "earliest"
)

quantity_modifiers=(
    "${absolute_modifiers[@]}"
    "most"
    "least"
)

# Make HTTP request to get URL.
get() {
    local code=$(curl -Ls $2 -o /dev/null -w "%{http_code}")
    if [ "$code" != "$1" ]; then
        exit 1
    fi
    code=$(curl -Ls $2/$3 -o /dev/null -w "%{http_code}")
    if [ "$code" != "$1" ]; then
        exit 1
    fi
}

# Create new URL.
new_url() {
    local path=$1
    local duration=$2
    local value=$3
    echo "$host/$path/$duration/$value/limit/$limit"
}

# BLOCKS

block_height=1

# Cursoring by block height
for duration in "${durations[@]}"; do
    url=$(new_url blocks $duration $block_height)
    get 200 $url height
done

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url blocks $duration $timemod)
        get 200 $url height
    done
done

# TRANSACTIONS

transaction_hash=F91E8F10E2948C6B87BD9230A6BBDA673006E65FDAE656B115475D9260F38104
transaction_id=5D973E118B964300015B3440
bad_hash1=F91E8F10E2948C6B87BD9230A6BBDA673006E65FDAE656B115475D9260F38103
bad_hash2=F91E8F10E2948C6B87BD9230A6BBDA673006E65FDAE656B115475D9260F381043
bad_id1=5D973E118B964300015B3443
bad_id2=5D973E118B964300015B34403

# Cursoring by Hash
for duration in "${durations[@]}"; do
    url=$(new_url transactions $duration $transaction_hash)
    get 200 $url hash

    url=$(new_url transactions $duration $bad_hash1)
    get 404 $url hash

    url=$(new_url transactions $duration $bad_hash2)
    get 409 $url hash
done

# Cursoring by ID
for duration in "${durations[@]}"; do
    url=$(new_url transactions $duration $transaction_id)
    get 200 $url hash

    url=$(new_url transactions $duration $bad_id1)
    get 404 $url hash

    url=$(new_url transactions $duration $bad_id2)
    get 409 $url hash
done

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url transactions $duration $timemod)
        get 200 $url hash
    done

    url=$(new_url transactions $duration longest)
    get 409 $url hash
done

# TRANSACTIONS BY TYPE

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url transactions $duration $timemod/type/transfer)
        get 200 $url hash

        url=$(new_url transactions $duration $timemod/type/registerNamespace)
        get 200 $url hash
    done

    url=$(new_url transactions $duration longest/type/transfer)
    get 409 $url hash

    url=$(new_url transactions $duration longest/type/registerNamespace)
    get 409 $url hash
done

# UNCONFIRMED TRANSACTIONS

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url transactions/unconfirmed $duration $timemod)
        get 200 $url hash
    done

    url=$(new_url transactions/unconfirmed $duration longest)
    get 409 $url hash

    url=$(new_url transactions/unconfirmed $duration longest)
    get 409 $url hash
done

# PARTIAL TRANSACTIONS

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url transactions/partial $duration $timemod)
        get 200 $url hash
    done

    url=$(new_url transactions/partial $duration longest)
    get 409 $url hash

    url=$(new_url transactions/partial $duration longest)
    get 409 $url hash
done

# NAMESPACES

namespace_object_id=5D973E2C8B964300015B3442
bad_object_id1=5D973E2C8B964300015B3449
bad_object_id2=5D973E2C8B964300015B34423
namespace_id=85BBEA6CC462B244
bad_id1=85BBEA6CC462B249
bad_id2=85BBEA6CC462B2443

# Cursoring by Object ID
for duration in "${durations[@]}"; do
    url=$(new_url namespaces $duration $namespace_object_id)
    get 200 $url id

    url=$(new_url namespaces $duration $bad_object_id1)
    get 404 $url id

    url=$(new_url namespaces $duration $bad_object_id2)
    get 409 $url id
done

# Cursoring by Namespace ID
for duration in "${durations[@]}"; do
    url=$(new_url namespaces $duration $namespace_id)
    get 200 $url id

    url=$(new_url namespaces $duration $bad_id1)
    get 404 $url id

    url=$(new_url namespaces $duration $bad_id2)
    get 409 $url id
done

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url namespaces $duration $timemod)
        get 200 $url id
    done

    url=$(new_url namespaces $duration longest)
    get 409 $url id
done

# MOSAICS

mosaic_id=439AA7CDE850B280
bad_id1=439AA7CDE850B289
bad_id2=439AA7CDE850B2809

# Cursoring by Mosaic ID
for duration in "${durations[@]}"; do
    url=$(new_url mosaics $duration $mosaic_id)
    get 200 $url id

    url=$(new_url mosaics $duration $bad_id1)
    get 404 $url id

    url=$(new_url mosaics $duration $bad_id2)
    get 409 $url id
done

# Cursoring by keywords
for duration in "${durations[@]}"; do
    for timemod in "${time_modifers[@]}"; do
        url=$(new_url mosaics $duration $timemod)
        get 200 $url id
    done

    url=$(new_url mosaics $duration longest)
    get 409 $url id
done

# ACCOUNTS

address=SB4OTFNIFU7XK3HBRI4KVAZFKTLP2ETNZDTVWQEP
hex_address=9078E995A82D3F756CE18A38AA832554D6FD126DC8E75B408F
public_key=D08A026CC35639F98FD74E77DB2B496D60EF9193A789F2153A6C7F81AFB39CEB
bad_address1=SB4OTFNIFU7XK3HBRI4KVAZFKTLP2ETNZDTVWQEQ
bad_address2=SB4OTFNIFU7XK3HBRI4KVAZFKTLP2ETNZDTVWQEPQ
bad_hex_address1=9078E995A82D3F756CE18A38AA832554D6FD126DC8E75B4080
bad_hex_address2=9078E995A82D3F756CE18A38AA832554D6FD126DC8E75B408F0
bad_public_key1=D08A026CC35639F98FD74E77DB2B496D60EF9193A789F2153A6C7F81AFB39CE0
bad_public_key2=D08A026CC35639F98FD74E77DB2B496D60EF9193A789F2153A6C7F81AFB39CEB0

test_account() {
    local path=$1
    # Cursoring by Base32 Address.
    for duration in "${durations[@]}"; do
        url=$(new_url accounts/$path $duration $address)
        get 200 $url address

        url=$(new_url accounts/$path $duration $bad_address1)
        get 404 $url address

        url=$(new_url accounts/$path $duration $bad_address2)
        get 409 $url address
    done

    # Cursoring by Hex Address.
    for duration in "${durations[@]}"; do
        url=$(new_url accounts/$path $duration $hex_address)
        get 200 $url address

        url=$(new_url accounts/$path $duration $bad_hex_address1)
        get 404 $url address

        url=$(new_url accounts/$path $duration $bad_hex_address2)
        get 409 $url address
    done

    # Cursoring by Public Key.
    for duration in "${durations[@]}"; do
        url=$(new_url accounts/$path $duration $public_key)
        get 200 $url address

        url=$(new_url accounts/$path $duration $bad_public_key1)
        get 404 $url address

        url=$(new_url accounts/$path $duration $bad_public_key2)
        get 409 $url address
    done

    # Cursoring by keywords
    for duration in "${durations[@]}"; do
        for quantmod in "${quantity_modifiers[@]}"; do
            url=$(new_url accounts/$path $duration $quantmod)
            get 200 $url address
        done

        url=$(new_url accounts/$path $duration longest)
        get 409 $url address
    done
}

test_account importance
test_account harvested/blocks
test_account harvested/fees
test_account balance/currency
test_account balance/harvest
