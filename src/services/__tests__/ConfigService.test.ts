import { ConfigProvider, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { ConfigService, ConfigurationError } from '../ConfigService.js'

describe('ConfigService', () => {
  const makeTestConfig = (overrides: Record<string, string> = {}) => {
    const config = {
      DISCORD_TOKEN: 'test-discord-token',
      OPENAI_KEY: 'test-openai-key',
      ...overrides,
    }

    return ConfigProvider.fromMap(new Map(Object.entries(config)))
  }

  const makeTestLayer = (overrides: Record<string, string> = {}) => Layer.setConfigProvider(makeTestConfig(overrides))

  it('should load valid configuration', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ConfigService
        const config = service.config

        expect(config.discordToken).toBe('test-discord-token')
        expect(config.openaiKey).toBe('test-openai-key')
        expect(config.channelIds).toHaveLength(5)
        expect(config.messageFiltering.enabled).toBe(true)
        expect(config.messageFiltering.minMessageLength).toBe(10)
      }).pipe(Effect.provide(ConfigService.Default), Effect.provide(makeTestLayer())),
    )
  })

  it('should fail when DISCORD_TOKEN is missing', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* ConfigService
      }).pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['OPENAI_KEY', 'test-key']])))),
      ),
    )

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const error = exit.cause
      expect(error._tag).toBe('Fail')
      if (error._tag === 'Fail') {
        expect(error.error).toBeInstanceOf(ConfigurationError)
        expect((error.error as ConfigurationError).message).toContain('DISCORD_TOKEN environment variable is required')
      }
    }
  })

  it('should fail when OPENAI_KEY is missing', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* ConfigService
      }).pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['DISCORD_TOKEN', 'test-token']])))),
      ),
    )

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const error = exit.cause
      expect(error._tag).toBe('Fail')
      if (error._tag === 'Fail') {
        expect(error.error).toBeInstanceOf(ConfigurationError)
        expect((error.error as ConfigurationError).message).toContain('OPENAI_KEY environment variable is required')
      }
    }
  })

  it('should handle Bot prefix in discord token correctly', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ConfigService

        expect(service.getRawDiscordToken()).toBe('test-discord-token')
        expect(service.getBotDiscordToken()).toBe('Bot test-discord-token')
      }).pipe(
        Effect.provide(ConfigService.Default),
        Effect.provide(makeTestLayer({ DISCORD_TOKEN: 'Bot test-discord-token' })),
      ),
    )
  })

  it('should add Bot prefix when missing', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ConfigService

        expect(service.getRawDiscordToken()).toBe('test-discord-token')
        expect(service.getBotDiscordToken()).toBe('Bot test-discord-token')
      }).pipe(Effect.provide(ConfigService.Default), Effect.provide(makeTestLayer())),
    )
  })
})
