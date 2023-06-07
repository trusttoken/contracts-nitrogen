import { expect, use } from 'chai'
import { MockERC4626Vault__factory } from 'contracts'
import { solidity } from 'ethereum-waffle'
import { calculateWaterfallWithoutFees } from 'fixtures/utils'
import { describe, it } from 'mocha'

import { structuredIndexedPortfolioFixture } from 'fixtures/structuredIndexedPortfolioFixture'
import { setupFixtureLoader } from 'test/setup'
import {
  calculateTranchesValuesAfterFees,
  createAndRegisterInvestment,
  getTranchesData,
  getTxTimestamp, setNextBlockTimestamp, startAndGetTimestamp, sumArray,
} from 'utils'

use(solidity)

const INVESTMENT_DEPOSIT_AMOUNT = 1_000_000

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

describe('StructuredIndexedPortfolio.executeRedeemAndUnregister.closed', () => {
  const loadFixture = setupFixtureLoader()

  describe('with fees', () => {
    it('senior full, junior empty, equity empty', async () => {
      const { portfolio, parseMockToken, tranches, setProtocolAndTranchesFeeRates, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)
      const tranchesValuesAfterRegister = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterRegister, DEFAULT_PROTOCOL_FEE_RATE, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterRegister, depositTimestampElapsed)
      const tranchesValuesAfterDeposit = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterDeposit, DEFAULT_PROTOCOL_FEE_RATE, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(tranchesValuesAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2])

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(0)
      expect(tranchesData[1].distributedAssets).to.eq(0)
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })

    it('senior full, junior full, equity empty', async () => {
      const { portfolio, parseMockToken, tranches, setProtocolAndTranchesFeeRates, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)
      const tranchesValuesAfterRegister = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterRegister, DEFAULT_PROTOCOL_FEE_RATE, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterRegister, depositTimestampElapsed)
      const tranchesValuesAfterDeposit = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterDeposit, DEFAULT_PROTOCOL_FEE_RATE, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(tranchesValuesAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2].add(waterfallAfterClose[1]))

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(0)
      expect(tranchesData[1].distributedAssets).to.eq(waterfallAfterClose[1])
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })

    it('senior full, junior full, equity overflow', async () => {
      const { portfolio, parseMockToken, tranches, setProtocolAndTranchesFeeRates, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)
      const tranchesValuesAfterRegister = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterRegister, DEFAULT_PROTOCOL_FEE_RATE, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterRegister, depositTimestampElapsed)
      const tranchesValuesAfterDeposit = calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfallAfterDeposit, DEFAULT_PROTOCOL_FEE_RATE, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(tranchesValuesAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, tranchesValuesAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2].add(waterfallAfterClose[1]).add(waterfallAfterClose[0]))

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(waterfallAfterClose[0])
      expect(tranchesData[1].distributedAssets).to.eq(waterfallAfterClose[1])
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })
  })

  describe('no fees', () => {
    it('senior full, junior empty, equity empty', async () => {
      const { portfolio, parseMockToken, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, waterfallAfterRegister, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(waterfallAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, waterfallAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2])

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(0)
      expect(tranchesData[1].distributedAssets).to.eq(0)
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })

    it('senior full, junior full, equity empty', async () => {
      const { portfolio, parseMockToken, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, waterfallAfterRegister, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(waterfallAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, waterfallAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2].add(waterfallAfterClose[1]))

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(0)
      expect(tranchesData[1].distributedAssets).to.eq(waterfallAfterClose[1])
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })

    it('senior full, junior full, equity overflow', async () => {
      const { portfolio, parseMockToken, wallet, depositToTranches } = await loadFixture(structuredIndexedPortfolioFixture)
      const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)

      await depositToTranches(portfolio, depositAmounts, wallet)

      const startTxTimestamp = await startAndGetTimestamp(portfolio)
      const portfolioEndDate = (await portfolio.endDate()).toNumber()

      const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)

      const registerTimeElapsed = investment.createTxTimestamp - startTxTimestamp
      const waterfallAfterRegister = await calculateWaterfallWithoutFees(portfolio, depositAmounts, registerTimeElapsed)

      const depositTimestampElapsed = 10
      const depositTimestamp = investment.createTxTimestamp + 10
      const waterfallAfterDeposit = await calculateWaterfallWithoutFees(portfolio, waterfallAfterRegister, depositTimestampElapsed)

      const investmentDepositAmount = sumArray(waterfallAfterDeposit)
      await setNextBlockTimestamp(depositTimestamp)
      const depositTx = await portfolio.executeDeposit(investment.address, investmentDepositAmount)
      const depositTxTimestamp = await getTxTimestamp(depositTx)

      const closeTimeElapsed = portfolioEndDate - depositTxTimestamp
      const waterfallAfterClose = await calculateWaterfallWithoutFees(portfolio, waterfallAfterDeposit, closeTimeElapsed)

      await setNextBlockTimestamp(portfolioEndDate + 1)
      await portfolio.close()

      await portfolio.executeRedeemAndUnregister(investment.address, waterfallAfterClose[2].add(waterfallAfterClose[1]).add(waterfallAfterClose[0]))

      const tranchesData = await getTranchesData(portfolio)

      expect(tranchesData[0].distributedAssets).to.eq(waterfallAfterClose[0])
      expect(tranchesData[1].distributedAssets).to.eq(waterfallAfterClose[1])
      expect(tranchesData[2].distributedAssets).to.eq(waterfallAfterClose[2])
    })
  })

  it('emits InvestmentUnregistered & ExecutedRedeem events', async () => {
    const { portfolio, wallet, parseMockToken } = await loadFixture(structuredIndexedPortfolioFixture)
    const investmentDepositAmount = parseMockToken(INVESTMENT_DEPOSIT_AMOUNT)

    await portfolio.start()
    const portfolioEndDate = (await portfolio.endDate()).toNumber()

    const investment = await createAndRegisterInvestment(portfolio, wallet, MockERC4626Vault__factory)
    await investment.approveAndDeposit(investmentDepositAmount, portfolio.address)

    await setNextBlockTimestamp(portfolioEndDate + 1)
    await portfolio.close()

    const shares = await investment.convertToShares(investmentDepositAmount)
    await expect(portfolio.executeRedeemAndUnregister(investment.address, investmentDepositAmount))
      .to.emit(portfolio, 'InvestmentUnregistered')
      .withArgs(investment.address)
      .to.emit(portfolio, 'ExecutedRedeem')
      .withArgs(investment.address, shares, investmentDepositAmount)
  })
})
