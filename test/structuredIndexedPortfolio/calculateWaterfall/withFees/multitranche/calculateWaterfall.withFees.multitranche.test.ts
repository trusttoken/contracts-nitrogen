import { Zero } from '@ethersproject/constants'
import { MockERC4626Vault__factory } from 'build/types'
import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { structuredIndexedPortfolioFixture } from 'fixtures/structuredIndexedPortfolioFixture'
import { setupFixtureLoader } from 'test/setup'
import {
  ONE_YEAR_IN_SECONDS,
  getHalfPortfolioDuration,
  getTxTimestamp,
  timeTravelTo,
  calculateTranchesValuesAfterFees,
  startTimeTravelAndClosePortfolio,
  percentToBips,
  ONE_DAY_IN_SECONDS,
  getTranchesVirtualTokenBalances,
  createAndRegisterInvestment,
  sumArray,
  startAndGetTimestamp,
  calculateTranchesValuesAfterTime,
} from 'utils'

use(solidity)

const DEFAULT_PROTOCOL_FEE_RATE = 400
const EQUITY_FEE_RATE = 100
const JUNIOR_FEE_RATE = 200
const SENIOR_FEE_RATE = 300
const TRANCHES_FEE_RATES = [
  EQUITY_FEE_RATE,
  JUNIOR_FEE_RATE,
  SENIOR_FEE_RATE,
]
const EQUITY_DEPOSIT_ASSETS = 1_000_000
const JUNIOR_DEPOSIT_ASSETS = 2_000_000
const SENIOR_DEPOSIT_ASSETS = 3_000_000
const DEPOSIT_AMOUNTS = [
  EQUITY_DEPOSIT_ASSETS,
  JUNIOR_DEPOSIT_ASSETS,
  SENIOR_DEPOSIT_ASSETS,
]

describe('StructuredIndexedPortfolio.calculateWaterfall.withFees.multitranche', () => {
  const loadFixture = setupFixtureLoader()

  describe('no assets deposited', () => {
    it('capital formation', async () => {
      const { portfolio, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq([Zero, Zero, Zero])
    })

    it('live', async () => {
      const { portfolio, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      await portfolio.start()
      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq([Zero, Zero, Zero])
    })

    it('closed', async () => {
      const { portfolio, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      await startTimeTravelAndClosePortfolio(portfolio)

      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq([Zero, Zero, Zero])
    })
  })

  describe('with assets deposited', () => {
    it('capital formation', async () => {
      const { portfolio, depositToTranches, parseMockToken, wallet, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
      await depositToTranches(portfolio, depositAmounts, wallet)

      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq(depositAmounts)
    })

    describe('live', () => {
      it('senior underflow, junior empty, equity empty', async () => {
        const { portfolio, depositToTranches, parseMockToken, wallet, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
        const timeElapsed = await getHalfPortfolioDuration(portfolio)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const seniorTrancheDepositAssets = depositAmounts[2]
        await depositToTranches(portfolio, depositAmounts, wallet)

        const startTx = await portfolio.start()
        const startTxTimestamp = await getTxTimestamp(startTx)

        const assumedSeniorTrancheValue = seniorTrancheDepositAssets.sub(10000)
        await portfolio.setVirtualTokenBalance(assumedSeniorTrancheValue)

        await timeTravelTo(startTxTimestamp + timeElapsed)

        const tranchesValues = [Zero, Zero, assumedSeniorTrancheValue]
        const expectedTranchesValues = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

        const waterfall = await portfolio.calculateWaterfall()
        expect(waterfall).to.deep.eq(expectedTranchesValues)
      })

      it('senior full, junior empty, equity empty', async () => {
        const { tranches, portfolio, wallet, depositAndCalculateAssumedTranchesValue, parseMockToken, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
        const timeElapsed = await getHalfPortfolioDuration(portfolio)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const [, , assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)

        const startTx = await portfolio.start()
        const startTxTimestamp = await getTxTimestamp(startTx)

        await portfolio.setVirtualTokenBalance(assumedSeniorTrancheValue)

        await timeTravelTo(startTxTimestamp + timeElapsed)

        const tranchesValues = [Zero, Zero, assumedSeniorTrancheValue]
        const expectedTranchesValues = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

        const waterfall = await portfolio.calculateWaterfall()
        expect(waterfall).to.deep.eq(expectedTranchesValues)
      })

      it('senior full, junior underflow, equity empty', async () => {
        const { tranches, portfolio, wallet, parseMockToken, depositAndCalculateAssumedTranchesValue, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
        const timeElapsed = await getHalfPortfolioDuration(portfolio)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const [, , assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)
        const assumedJuniorTrancheValue = parseMockToken(500_000)

        const startTx = await portfolio.start()
        const startTxTimestamp = await getTxTimestamp(startTx)

        const newVirtualTokenBalance = assumedJuniorTrancheValue.add(assumedSeniorTrancheValue)
        await portfolio.setVirtualTokenBalance(newVirtualTokenBalance)

        await timeTravelTo(startTxTimestamp + timeElapsed)

        const tranchesValues = [Zero, assumedJuniorTrancheValue, assumedSeniorTrancheValue]
        const expectedTranchesValues = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

        const waterfall = await portfolio.calculateWaterfall()
        expect(waterfall).to.deep.eq(expectedTranchesValues)
      })

      it('senior full, junior full, equity empty', async () => {
        const { tranches, portfolio, wallet, parseMockToken, depositAndCalculateAssumedTranchesValue, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
        const timeElapsed = await getHalfPortfolioDuration(portfolio)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const [, assumedJuniorTrancheValue, assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)

        const startTx = await portfolio.start()
        const startTxTimestamp = await getTxTimestamp(startTx)

        const newVirtualTokenBalance = assumedJuniorTrancheValue.add(assumedSeniorTrancheValue)
        await portfolio.setVirtualTokenBalance(newVirtualTokenBalance)

        await timeTravelTo(startTxTimestamp + timeElapsed)

        const tranchesValues = [Zero, assumedJuniorTrancheValue, assumedSeniorTrancheValue]
        const expectedTranchesValues = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

        const waterfall = await portfolio.calculateWaterfall()
        expect(waterfall).to.deep.eq(expectedTranchesValues)
      })

      it('senior full, junior full, equity surplus', async () => {
        const { tranches, portfolio, wallet, parseMockToken, depositAndCalculateAssumedTranchesValue, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
        const timeElapsed = await getHalfPortfolioDuration(portfolio)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const [, assumedJuniorTrancheValue, assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)
        const assumedEquityTrancheValue = parseMockToken(500_000)
        const tranchesValues = [assumedEquityTrancheValue, assumedJuniorTrancheValue, assumedSeniorTrancheValue]

        const startTx = await portfolio.start()
        const startTxTimestamp = await getTxTimestamp(startTx)

        const newVirtualTokenBalance = assumedEquityTrancheValue.add(assumedJuniorTrancheValue).add(assumedSeniorTrancheValue)
        await portfolio.setVirtualTokenBalance(newVirtualTokenBalance)

        await timeTravelTo(startTxTimestamp + timeElapsed)

        const expectedTranchesValues = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

        const waterfall = await portfolio.calculateWaterfall()
        expect(waterfall).to.deep.eq(expectedTranchesValues)
      })

      it('investment gained value', async () => {
        const { portfolio, parseMockToken, depositToTranches, wallet, setProtocolAndTranchesFeeRates, tranches } = await loadFixture(structuredIndexedPortfolioFixture)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const investmentDepositAmount = depositAmounts[0]
        const doubleInvestmentAmount = investmentDepositAmount.mul(2)

        await depositToTranches(portfolio, depositAmounts, wallet)

        const startTxTimestamp = await startAndGetTimestamp(portfolio)
        const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)
        const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
        const increaseValueTx = await investment.setValue(doubleInvestmentAmount)

        const depositTxTimestamp = await getTxTimestamp(depositTx)
        const increaseValueTxTimestamp = await getTxTimestamp(increaseValueTx)

        const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
        const depositTimeElapsed = depositTxTimestamp - investment.createTxTimestamp
        const increaseValueTimeElapsed = increaseValueTxTimestamp - depositTxTimestamp

        const tranchesValuesAfterRegister = await calculateTranchesValuesAfterTime(portfolio, depositAmounts, registerTimeElapsed)
        const tranchesValuesAfterDeposit = await calculateTranchesValuesAfterTime(portfolio, tranchesValuesAfterRegister, depositTimeElapsed)
        const portfolioValueAfterIncrease = sumArray(tranchesValuesAfterDeposit).add(investmentDepositAmount)
        const tranchesValuesAfterFees = await calculateTranchesValuesAfterTime(portfolio, tranchesValuesAfterDeposit, increaseValueTimeElapsed, portfolioValueAfterIncrease)

        expect(await portfolio.calculateWaterfall()).to.deep.eq(tranchesValuesAfterFees)
      })

      it('investment lost value', async () => {
        const { portfolio, parseMockToken, depositToTranches, wallet, setProtocolAndTranchesFeeRates, tranches } = await loadFixture(structuredIndexedPortfolioFixture)
        await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
        const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
        const investmentDepositAmount = depositAmounts[0]
        const halfInvestmentAmount = investmentDepositAmount.div(2)

        await depositToTranches(portfolio, depositAmounts, wallet)

        const startTxTimestamp = await startAndGetTimestamp(portfolio)
        const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)
        const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
        const increaseValueTx = await investment.setValue(halfInvestmentAmount)

        const depositTxTimestamp = await getTxTimestamp(depositTx)
        const increaseValueTxTimestamp = await getTxTimestamp(increaseValueTx)

        const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
        const depositTimeElapsed = depositTxTimestamp - investment.createTxTimestamp
        const increaseValueTimeElapsed = increaseValueTxTimestamp - depositTxTimestamp

        const tranchesValuesAfterRegister = await calculateTranchesValuesAfterTime(portfolio, depositAmounts, registerTimeElapsed)
        const tranchesValuesAfterDeposit = await calculateTranchesValuesAfterTime(portfolio, tranchesValuesAfterRegister, depositTimeElapsed)
        const portfolioValueAfterIncrease = sumArray(tranchesValuesAfterDeposit).sub(halfInvestmentAmount)
        const tranchesValuesAfterFees = await calculateTranchesValuesAfterTime(portfolio, tranchesValuesAfterDeposit, increaseValueTimeElapsed, portfolioValueAfterIncrease)

        expect(await portfolio.calculateWaterfall()).to.deep.eq(tranchesValuesAfterFees)
      })
    })

    it('senior fee bigger than value', async () => {
      const { tranches, portfolio, wallet, parseMockToken, depositAndCalculateAssumedTranchesValue, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      const timeElapsed = await getHalfPortfolioDuration(portfolio)
      const maxFeeRate = Math.round(percentToBips(200) * ONE_YEAR_IN_SECONDS / timeElapsed)
      const tranchesFeeRates = [EQUITY_FEE_RATE, JUNIOR_FEE_RATE, maxFeeRate]
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, tranchesFeeRates)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
      const [, assumedJuniorTrancheValue, assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)
      const assumedEquityTrancheValue = parseMockToken(500_000)
      const tranchesValues = [assumedEquityTrancheValue, assumedJuniorTrancheValue, assumedSeniorTrancheValue]

      const startTx = await portfolio.start()
      const startTxTimestamp = await getTxTimestamp(startTx)

      const newVirtualTokenBalance = assumedEquityTrancheValue.add(assumedJuniorTrancheValue).add(assumedSeniorTrancheValue)
      await portfolio.setVirtualTokenBalance(newVirtualTokenBalance)

      await timeTravelTo(startTxTimestamp + timeElapsed)

      const [expectedEquityValue, expectedJuniorValue] = calculateTranchesValuesAfterFees(tranches, tranchesFeeRates, tranchesValues, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)

      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq([expectedEquityValue, expectedJuniorValue, Zero])
    })

    it('fee bigger than value', async () => {
      const { tranches, portfolio, wallet, parseMockToken, depositAndCalculateAssumedTranchesValue, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      const timeElapsed = await getHalfPortfolioDuration(portfolio)
      const maxFeeRate = Math.round(percentToBips(200) * ONE_YEAR_IN_SECONDS / timeElapsed)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, [maxFeeRate, maxFeeRate, maxFeeRate])
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
      const [, assumedJuniorTrancheValue, assumedSeniorTrancheValue] = await depositAndCalculateAssumedTranchesValue(depositAmounts, wallet, timeElapsed)
      const assumedEquityTrancheValue = parseMockToken(500_000)

      const startTx = await portfolio.start()
      const startTxTimestamp = await getTxTimestamp(startTx)

      const newVirtualTokenBalance = assumedEquityTrancheValue.add(assumedJuniorTrancheValue).add(assumedSeniorTrancheValue)
      await portfolio.setVirtualTokenBalance(newVirtualTokenBalance)

      await timeTravelTo(startTxTimestamp + timeElapsed)

      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq([Zero, Zero, Zero])
    })

    it('closed', async () => {
      const { portfolio, depositToTranches, wallet, parseMockToken, tranches, setProtocolAndTranchesFeeRates } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
      await depositToTranches(portfolio, depositAmounts, wallet)

      const closeTxTimestamp = await startTimeTravelAndClosePortfolio(portfolio)
      const timeElapsedAfterClose = ONE_DAY_IN_SECONDS
      await timeTravelTo(closeTxTimestamp + timeElapsedAfterClose)

      const tranchesVirtualTokenBalances = await getTranchesVirtualTokenBalances(tranches)

      const tranchesZeroFeeRates = [0, 0, 0]
      const expectedWaterfall = calculateTranchesValuesAfterFees(
        tranches,
        tranchesZeroFeeRates,
        tranchesVirtualTokenBalances,
        DEFAULT_PROTOCOL_FEE_RATE,
        timeElapsedAfterClose,
      )

      const waterfall = await portfolio.calculateWaterfall()
      expect(waterfall).to.deep.eq(expectedWaterfall)
    })
  })
})
