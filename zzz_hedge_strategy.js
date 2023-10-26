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

// returns the best trading strategy for the first hour	// sell = 1 | hold = 0 | buy = -1
const getStrategy = ({
	prices,	// array of hourly prices, e.g. [0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429, 0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429];
	minPriceDelta = 0.1,	// mimimum price difference from highest or lowest price to sell/buy
	soc = 0,	// Battery State of Charge at start of first hour in %
	batCapacity = 5.05, // in kWh
	chargePower = 2000, // in Watt
	dischargePower = 1700, // in Watt
}) => {
	if (!prices || prices.length < 3) throw Error('insufficient or no price data available');

	// calculate charge speeds as percentage per hour
	const chargeSpeed = chargePower / (batCapacity * 10); // % per hour
	const dischargeSpeed = dischargePower / (batCapacity * 10); // % per hour
	const batCapPerc = batCapacity / 100;
	const maxChargeTime = Math.ceil(100 / chargeSpeed);
	const maxDisChargeTime = Math.ceil(100 / dischargeSpeed);
	const maxStartChargeTime = Math.ceil((100 - soc) / chargeSpeed);
	const maxStartDisChargeTime = Math.ceil(soc / dischargeSpeed);

	const prcs = [...prices]; // .slice(0, 48);
	const avgPrice = prcs.reduce((a, b) => (a + b)) / prcs.length;

	// mapp possible sell - buy
	const map = [...prcs]
		.map((price, idx) => {
			const futurePrices = [...prcs].slice(idx);
			const futureMin = Math.min(...futurePrices);
			const futureMinIndex = futurePrices.findIndex((prc) => prc === futureMin);
			const futureMax = Math.max(...futurePrices);
			const futureMaxIndex = futurePrices.findIndex((prc) => prc === futureMax);
			const sell = (price - futureMin) > minPriceDelta * 0.6;
			const buy = (futureMax - price) > minPriceDelta;
			let strategy = 0; // 'hold';
			if (sell) strategy = 1; // 'sell';
			if (buy) strategy = -1; // 'buy';
			if (sell && buy) strategy = (futureMinIndex < futureMaxIndex) ? 1 : -1;
			return {
				price,
				strategy,
				// sell,
				// futureMinIndex,
				// buy,
				// futureMaxIndex,
			};
		})
		.filter((mappedPrice) => mappedPrice.strategy !== 0);
	// console.log(map);

	// cut array in consecutive strategy periods
	const pricePeriods = [];
	pricePeriods.push([map[0]]);
	// console.log(pricePeriods);
	map.forEach((item, index) => {
		if (index === 0) return;
		const previousPricePeriodIndex = pricePeriods.length - 1;
		const previousPricePeriodLength = pricePeriods[previousPricePeriodIndex].length;
		const previousPeriod = pricePeriods[previousPricePeriodIndex];
		const previousItem = previousPeriod[previousPricePeriodLength - 1];
		if (item.strategy === previousItem.strategy) pricePeriods[previousPricePeriodIndex].push(item);
		else pricePeriods.push([item]);
	});
	// console.log(pricePeriods);

	// reduce number of hours per period to max charge/discharge capability
	const reducedPrices = pricePeriods
		.map((period, idx) => {
			// console.log(period);
			if (period[0].strategy === -1) {
				let maxTime = maxChargeTime;
				if (idx === 0) maxTime = maxStartChargeTime;
				const lowestValues = [...period]
					.sort((a, b) => a.price - b.price)
					.slice(0, maxTime)
					.reverse();
				// console.log(lowestValues);
				const trough = [...period].filter((item) => item.price <= lowestValues[0].price);
				// console.log(trough);
				return trough;
			}
			// strategy is sell
			let maxTime = maxDisChargeTime;
			if (idx === 0) maxTime = maxStartDisChargeTime;
			const highestValues = [...period]
				.sort((a, b) => b.price - a.price)
				.slice(0, maxTime)
				.reverse();
			// console.log(highestValues);
			const peak = [...period].filter((item) => item.price >= highestValues[0].price);
			// console.log(peak);
			return peak;
		})
		.flat()
		.slice(0, 10); // limit to first 10
	const peakPrices = reducedPrices.map((item) => item.price);
	console.log(reducedPrices, peakPrices);

	// return Hold strategy if first hour is not a peak price
	if (!peakPrices[0] || peakPrices[0] !== prcs[0]) return 0;





	const startState = {
		profit: 0,
		prices: reducedPrices, // peakPrices,
		soc,
		hourlyStrat: [],
	};
	const allResults = [];
	const stateAfter = (stateBefore) => {
		const price = stateBefore.prices.shift();
		if (price === undefined || price.price === undefined) {
			const finished = JSON.parse(JSON.stringify(stateBefore));
			// add value of soc
			finished.socValue = finished.soc * batCapPerc * avgPrice; // value the soc against avg price
			allResults.push(finished);
			return;
		}
		// all possible outcomes are recursively handled
		const strat = [0]; // standard strategy = hold;
		if (price.strategy === 2) {
			strat.push(1); // add sell strategy
			strat.push(-1); // add buy strategy
		} else strat.push(price.strategy);
		// run all 3 possible strategies
		strat.forEach((strategy) => {
			if (price === undefined || price.price === undefined) return null;
			let afterState = { ...stateBefore };
			afterState.prices = [...stateBefore.prices];
			afterState.hourlyStrat = [...stateBefore.hourlyStrat];
			// sell
			if (strategy > 0 && afterState.soc > 0)	{ // can only sell when there is enough charge
				const sellingPercent = afterState.soc < dischargeSpeed ? afterState.soc : dischargeSpeed;
				afterState.profit += sellingPercent * batCapPerc * price.price;
				afterState.soc -= sellingPercent;
			}
			// buy
			if (strategy < 0 && afterState.soc < 100)	{	// can only buy when batt is not full
				const buyingPercent = chargeSpeed > (100 - afterState.soc) ? (100 - afterState.soc) : chargeSpeed;
				afterState.profit -= buyingPercent * batCapPerc * price.price;
				afterState.soc += buyingPercent;
			}
			// hold
			// if (strategy === 0) { } // do nothing
			afterState.hourlyStrat.push({ [price.price]: strategy, soc: afterState.soc, profit: afterState.profit });
			afterState = stateAfter(afterState);
			return afterState;
		});
	};

	stateAfter(startState);
	const sorted = allResults.sort((a, b) => (b.profit + b.socValue) - (a.profit + a.socValue));
	// console.dir(sorted, { depth: null });
	// console.log('tested:', sorted.length);
	console.log('best strat:', sorted[0]);
	// if (sorted[0].profit < 0) return 0; // hold when negative profit
	return sorted[0].hourlyStrat[0][prices[0]];
};

// TEST
// const prices = [0.25, 0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429, 0.331, 0.32, 0.322, 0.32, 0.328, 0.339, 0.429];
// const prices = [0.16, 0.17, 0.16, 0.13, 0.12, 0.12, 0.12, 0.12, 0.11, 0.11, 0.12, 0.15, 0.16, 0.16, 0.12, 0.10, 0.07, 0.04, 0.02, 0.01, 0.01, 0.06, 0.08, 0.11, 0.16, 0.17, 0.17, 0.17, 0.16];
// const prices = [0.29, 0.28, 0.27, 0.27, 0.27, 0.29, 0.30, 0.33, 0.32, 0.28, 0.27, 0.21, 0.22, 0.22, 0.21, 0.23, 0.25, 0.27, 0.29, 0.29, 0.30, 0.29, 0.28, 0.27];

const prices = [
	// 0.3054, 0.2918, 0.2885, 
	0.2841,
	0.2856, 0.2937, 0.325, 0.3515,
	0.3459, 0.3206, 0.2977, 0.2833,
	0.2699, 0.261728, 0.2611956,
	0.2697382, 0.2958379,
	0.3299599, 0.4283329,
	0.4895831, 0.5087132,
	0.44683379999999995, 0.3645901,
	0.3232686,

  0.31740009999999996,
	0.30666740000000003, 0.2983184,
	0.28619419999999995, 0.2718799,
	0.2704279, 0.2886989,
	0.32415190000000005, 0.3211632,
	0.3151616, 0.2767199,
	0.2807613, 0.2765747,
	0.2787164, 0.2905139,
	0.2961646, 0.3052517,
	0.3467426, 0.41173170000000003,
	0.4762005, 0.45746970000000003,
	0.38278850000000003, 0.3484245,
	0.3130078,
];

console.dir(getStrategy({ prices, soc: 50 }), { depth: null });

module.exports = {
	getStrategy,
};
