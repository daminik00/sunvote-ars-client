# Contributing to sunvote-ars-client

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/daminik00/sunvote-ars-client.git
   cd sunvote-ars-client
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the build:

   ```bash
   npm run build
   ```

4. Run tests:

   ```bash
   npm test
   ```

## Making Changes

1. Fork the repository and create a branch from `main`.
2. If you have added code that should be tested, add tests.
3. Ensure the test suite passes (`npm test`).
4. Ensure your code passes the linter (`npm run lint`).
5. Write a clear commit message following [Conventional Commits](https://www.conventionalcommits.org/).

## Pull Request Process

1. Update the `README.md` if your change affects the public API.
2. Add an entry to `CHANGELOG.md` under an `[Unreleased]` section.
3. Ensure CI checks pass on your pull request.
4. A maintainer will review and merge your PR.

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/daminik00/sunvote-ars-client/issues).
- Include steps to reproduce, expected behavior, and actual behavior.
- Mention your OS, Node.js version, and package version.

## Code Style

- TypeScript strict mode is enabled.
- Use the existing code patterns as a guide.
- Prefer explicit types over `any`.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
