import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  dir: './', // Next.js project root directory
})

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  // Run this file before testing (it will perform some global configuration).
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // Allow paths like @/xx to be used in tests as well.
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Optional: Test only .test.ts/.test.tsx files in src
  testMatch: ['**/*.(test|spec).(ts|tsx)'],
}

export default createJestConfig(customJestConfig)
