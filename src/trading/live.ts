import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ZeroExQuoteProvider } from "../market/zeroex";
import type { TradeRequest, TradeResult } from "./types";

const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as Address;

export interface LiveExecutionConfig {
  apiKey: string;
  rpcUrl: string;
  privateKey: `0x${string}`;
  walletAddress: `0x${string}`;
  enabled: boolean;
}

export class BaseLiveExecutor {
  async execute(request: TradeRequest, config: LiveExecutionConfig): Promise<TradeResult> {
    if (!config.enabled) {
      return {
        mode: "live",
        status: "rejected",
        request,
        message: "Live execution is disabled. Set LIVE_TRADING_ENABLED=true explicitly."
      };
    }

    if (!config.apiKey || !config.privateKey || !config.walletAddress) {
      return {
        mode: "live",
        status: "rejected",
        request,
        message: "Live execution credentials are incomplete."
      };
    }

    const account = privateKeyToAccount(config.privateKey);
    if (account.address.toLowerCase() !== config.walletAddress.toLowerCase()) {
      return {
        mode: "live",
        status: "rejected",
        request,
        message: "Configured wallet address does not match the private key."
      };
    }

    const publicClient = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(config.rpcUrl)
    });

    const quoteProvider = new ZeroExQuoteProvider(config.apiKey, account.address);
    const quote = await quoteProvider.getQuote({
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountInWei: request.amountInWei,
      slippageBps: request.slippageBps
    });

    if (quote.simulationIncomplete) {
      return {
        mode: "live",
        status: "rejected",
        request,
        amountOutWei: quote.amountOutWei,
        message: "0x could not fully validate the firm quote."
      };
    }

    if (quote.allowanceTarget && request.tokenIn.toLowerCase() !== NATIVE_ETH.toLowerCase()) {
      const allowance = await publicClient.readContract({
        address: request.tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, quote.allowanceTarget]
      });

      if (allowance < request.amountInWei) {
        if (!quote.allowanceRequired) {
          return {
            mode: "live",
            status: "rejected",
            request,
            amountOutWei: quote.amountOutWei,
            message: "0x requires an allowance, but did not provide a required amount."
          };
        }

        const approvalHash = await walletClient.writeContract({
          address: request.tokenIn,
          abi: erc20Abi,
          functionName: "approve",
          args: [quote.allowanceTarget, quote.allowanceRequired],
          account
        });

        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
          confirmations: 1
        });

        if (approvalReceipt.status !== "success") {
          return {
            mode: "live",
            status: "rejected",
            request,
            amountOutWei: quote.amountOutWei,
            message: "Token approval transaction reverted."
          };
        }
      }
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: quote.transaction.to,
      data: quote.transaction.data as Hex,
      value: quote.transaction.value,
      gas: quote.transaction.gas,
      gasPrice: quote.transaction.gasPrice
    });

    return {
      mode: "live",
      status: "submitted",
      txHash: hash,
      request,
      amountOutWei: quote.amountOutWei,
      message: "Live swap transaction submitted to Base."
    };
  }
}
