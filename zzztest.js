/*
Copyright 2019 - 2023, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.powerhour.

com.gruijter.powerhour is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.powerhour is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.powerhour.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

// returns the best trading strategy 	// sell = 1 | hold = 0 | buy = -1
const getStrategy = ({ prices, minPriceDelta = 0.08, soc = 0, batCapacity = 5.2, chargePower = 2000, dischargePower = 1750 }) => {

	const capacity = batCapacity || 5.2; // kWh
	const chargeSpeed = chargePower / (capacity * 10); // % per hour
	const dischargeSpeed = dischargePower / (capacity * 10); // % per hour
	const minDelta = minPriceDelta || 0.08; // mimimum price difference from highest or lowest price to sell/buy

	console.log(capacity, chargeSpeed, dischargeSpeed, minDelta);

	const avgPrice = prices.reduce((a, b) => (a + b)) / prices.length;
	const maxPrice = Math.max(...prices);
	const minPrice = Math.min(...prices);
	const peakPrices = prices
		.filter((price) => (price - minPrice) > minDelta || (maxPrice - price) > minDelta)
		.slice(0, 12); // limit to the first 12 peaks/troughs

	if (peakPrices[0] !== prices[0]) return 0; // Hold if not a peak price

	const startState = {
		profit: 0,
		prices: peakPrices,
		soc,
		hourlyStrat: [],
	};
	console.log(startState);

	const allResults = [];
	const stateAfter = (stateBefore) => {
		const price = stateBefore.prices.shift();

		const strat = [0]; // standard strategy = hold;
		if ((price - minPrice) > minDelta) strat.push(1); // add sell strategy
		if ((maxPrice - price) > minDelta) strat.push(-1); // add buy strategy

		// run all 3 strategies
		strat.forEach((strategy) => {
			if (price === undefined) return null;
			let afterState = { ...stateBefore };
			afterState.prices = [...stateBefore.prices];
			afterState.hourlyStrat = [...stateBefore.hourlyStrat];

			// hold
			if (strategy === 0) {
				afterState.hourlyStrat.push({ [price]: strategy, soc: afterState.soc });
				afterState = stateAfter(afterState);
				return afterState;
			}
			// sell
			if (strategy > 0) {
				if (afterState.soc < 1)	{ // can only sell when there is enough charge
					afterState.hourlyStrat.push({ [price]: strategy, soc: afterState.soc });
					afterState = stateAfter(afterState);
					return afterState;
				}
				const sellingPercent = afterState.soc < dischargeSpeed ? afterState.soc : dischargeSpeed; // soc or 50%
				afterState.profit += (sellingPercent / 100) * capacity * price;
				afterState.soc -= sellingPercent;
			}
			// buy
			if (strategy < 0) {
				if (afterState.soc > 99)	{	// can only buy when batt is not full
					afterState.hourlyStrat.push({ [price]: strategy, soc: afterState.soc });
					afterState = stateAfter(afterState);
					return afterState;
				}
				const buyingPercent = chargeSpeed > (100 - afterState.soc) ? (100 - afterState.soc) : chargeSpeed;
				afterState.profit -= (buyingPercent / 100) * capacity * price;
				afterState.soc += buyingPercent;
			}
			afterState.hourlyStrat.push({ [price]: strategy, soc: afterState.soc });
			afterState = stateAfter(afterState);
			return afterState;
		});

		// all prices done WHOOHOO> ready :)
		if (price === undefined) {
			// add value of soc
			stateBefore.socValue = (stateBefore.soc / 100) * capacity * avgPrice; // value the soc against avg price
			allResults.push(stateBefore);
		}

	};

	stateAfter(startState);
	console.dir(allResults, { depth: null });
	const sorted = allResults.sort((a, b) => (b.profit + b.socValue) - (a.profit + a.socValue));
	console.dir(sorted, { depth: null });
	console.log('best strat:', sorted[0]);
	return sorted[0].hourlyStrat[0][prices[0]];
};

// TEST
const prices = [0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429, 0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429];
console.dir(getStrategy({ prices, soc: 50 }), { depth: null });

module.exports = {
	getStrategy,
	// test,
};
