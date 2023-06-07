import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { calculateWaterfallWithoutFees } from 'fixtures/utils'
import { describe, it } from 'mocha'

import { structuredIndexedPortfolioFixture } from 'fixtures/structuredIndexedPortfolioFixture'
import { setupFixtureLoader } from 'test/setup'
import {
  calculateTranchesValuesAfterFees,
  getHalfPortfolioDuration,
  getTxTimestamp,
  setNextBlockTimestamp,
  sumArray,
} from 'utils'
import { deployMockERC4626Vault, deployMockToken } from 'fixtures/tasks'

use(solidity)

const ARBITRARY_DEPOSIT_AMOUNT = 1
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

describe('StructuredIndexedPortfolio.registerAndExecuteDeposit', () => {
  const loadFixture = setupFixtureLoader()

  it('when not paused only', async () => {
    const { portfolio, mockErc4626Vault } = await loadFixture(structuredIndexedPortfolioFixture)
    await portfolio.pause()
    await expect(portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('Pausable: paused')
  })

  it('only manager', async () => {
    const { portfolio, other, mockErc4626Vault } = await loadFixture(structuredIndexedPortfolioFixture)
    await expect(portfolio.connect(other).registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Only manager')
  })

  it('capital formation status', async () => {
    const { portfolio, mockErc4626Vault } = await loadFixture(structuredIndexedPortfolioFixture)
    await expect(portfolio.executeDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Portfolio is not live')
  })

  it('closed status', async () => {
    const { portfolio, mockErc4626Vault } = await loadFixture(structuredIndexedPortfolioFixture)
    await portfolio.close()
    await expect(portfolio.executeDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Portfolio is not live')
  })

  it('only vaults in registry', async () => {
    const { portfolio, mockErc4626Vault } = await loadFixture(structuredIndexedPortfolioFixture)
    await portfolio.start()
    await expect(portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Investment is not in the registry')
  })

  it('adds to investments', async () => {
    const { portfolio, mockErc4626Vault, token, vaultsRegistry } = await loadFixture(structuredIndexedPortfolioFixture)

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await token.mint(portfolio.address, ARBITRARY_DEPOSIT_AMOUNT)
    await portfolio.start()

    await portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT)
    expect(await portfolio.getInvestments()).to.deep.eq([mockErc4626Vault.address])
  })

  it('asset mismatched', async () => {
    const { wallet, portfolio, vaultsRegistry } = await loadFixture(structuredIndexedPortfolioFixture)

    const differentDecimalsToken = await deployMockToken(wallet, 1)
    const conflictingVault = await deployMockERC4626Vault(wallet, differentDecimalsToken)
    await vaultsRegistry.addVault(conflictingVault.address)

    await portfolio.start()

    await expect(portfolio.registerAndExecuteDeposit(conflictingVault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Asset mismatched')
  })

  it('investment already registered', async () => {
    const { portfolio, mockErc4626Vault, vaultsRegistry } = await loadFixture(structuredIndexedPortfolioFixture)

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await portfolio.start()
    await portfolio.register(mockErc4626Vault.address)

    await expect(portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.be.revertedWith('SIP: Investment already registered')
  })

  it('emits InvestmentRegistered event', async () => {
    const { portfolio, mockErc4626Vault, token, vaultsRegistry } = await loadFixture(structuredIndexedPortfolioFixture)

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await token.mint(portfolio.address, ARBITRARY_DEPOSIT_AMOUNT)
    await portfolio.start()

    await expect(portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, ARBITRARY_DEPOSIT_AMOUNT))
      .to.emit(portfolio, 'InvestmentRegistered')
      .withArgs(mockErc4626Vault.address)
  })

  it('returns shares', async () => {
    const { portfolio, mockErc4626Vault, token, parseMockToken, vaultsRegistry } = await loadFixture(structuredIndexedPortfolioFixture)
    const investmentDepositAmount = parseMockToken(INVESTMENT_DEPOSIT_AMOUNT)

    await portfolio.start()

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await token.mint(portfolio.address, investmentDepositAmount)

    const shares = await portfolio.callStatic.registerAndExecuteDeposit(mockErc4626Vault.address, investmentDepositAmount)
    expect(shares).to.eq(investmentDepositAmount)
  })

  it('virtual token balance decreases, no fees', async () => {
    const { portfolio, parseMockToken, mockErc4626Vault, vaultsRegistry, token, depositToTranches, wallet } = await loadFixture(structuredIndexedPortfolioFixture)
    const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
    const investmentDepositAmount = parseMockToken(INVESTMENT_DEPOSIT_AMOUNT)

    await depositToTranches(portfolio, depositAmounts, wallet)

    await portfolio.start()

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await token.mint(portfolio.address, investmentDepositAmount)

    const virtualTokenBalanceBefore = await portfolio.virtualTokenBalance()

    await portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, investmentDepositAmount)

    const virtualTokenBalanceAfter = await portfolio.virtualTokenBalance()

    const expectedVirtualTokenBalance = virtualTokenBalanceBefore.sub(investmentDepositAmount)
    expect(virtualTokenBalanceAfter).to.eq(expectedVirtualTokenBalance)
  })

  it('virtual token balance decreases, with fees', async () => {
    const { portfolio, parseMockToken, mockErc4626Vault, vaultsRegistry, token, depositToTranches, wallet, setProtocolAndTranchesFeeRates, tranches } = await loadFixture(structuredIndexedPortfolioFixture)
    await setProtocolAndTranchesFeeRates(tranches, DEFAULT_PROTOCOL_FEE_RATE, TRANCHES_FEE_RATES)
    const timeElapsed = await getHalfPortfolioDuration(portfolio)
    const depositAmounts = DEPOSIT_AMOUNTS.map(parseMockToken)
    const investmentDepositAmount = parseMockToken(INVESTMENT_DEPOSIT_AMOUNT)

    await depositToTranches(portfolio, depositAmounts, wallet)

    const startTx = await portfolio.start()
    const startTxTimestamp = await getTxTimestamp(startTx)

    await vaultsRegistry.addVault(mockErc4626Vault.address)
    await token.mint(portfolio.address, investmentDepositAmount)

    const waterfall = await calculateWaterfallWithoutFees(portfolio, depositAmounts, timeElapsed)
    const tranchesValuesAfterFees =
      calculateTranchesValuesAfterFees(tranches, TRANCHES_FEE_RATES, waterfall, DEFAULT_PROTOCOL_FEE_RATE, timeElapsed)
    const tranchesValuesAfterFeesSum = sumArray(tranchesValuesAfterFees)

    await setNextBlockTimestamp(startTxTimestamp + timeElapsed)
    await portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, investmentDepositAmount)

    const virtualTokenBalance = await portfolio.virtualTokenBalance()

    const expectedVirtualTokenBalance = tranchesValuesAfterFeesSum.sub(investmentDepositAmount)
    expect(virtualTokenBalance).to.eq(expectedVirtualTokenBalance)
  })

  it('deposit called on ERC4626 vault', async () => {
    const { portfolio, vaultsRegistry, mockErc4626Vault, token, parseMockToken } = await loadFixture(structuredIndexedPortfolioFixture)
    const depositAmount = parseMockToken(1_000_000)
    await token.mint(portfolio.address, depositAmount)
    await vaultsRegistry.addVault(mockErc4626Vault.address)

    await portfolio.start()

    await portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, depositAmount)
    expect('deposit').to.be.calledOnContractWith(mockErc4626Vault, [depositAmount, portfolio.address])
  })

  it('emits InvestmentRegistered & ExecutedDeposit events', async () => {
    const { portfolio, vaultsRegistry, mockErc4626Vault, token, parseMockToken } = await loadFixture(structuredIndexedPortfolioFixture)
    const depositAmount = parseMockToken(1_000_000)
    await token.mint(portfolio.address, depositAmount)
    await vaultsRegistry.addVault(mockErc4626Vault.address)

    await portfolio.start()

    const expectedShares = await mockErc4626Vault.convertToShares(depositAmount)
    await expect(portfolio.registerAndExecuteDeposit(mockErc4626Vault.address, depositAmount))
      .to.emit(portfolio, 'InvestmentRegistered')
      .withArgs(mockErc4626Vault.address)
      .to.emit(portfolio, 'ExecutedDeposit')
      .withArgs(mockErc4626Vault.address, depositAmount, expectedShares)
  })
})
