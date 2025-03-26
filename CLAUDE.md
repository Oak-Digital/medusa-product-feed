# Medusa Product Feed Plugin Development Guide

## Commands
- `yarn build`: Build the plugin
- `yarn dev`: Develop the plugin with hot reloading
- `yarn test`: Run all tests (not configured yet)
- `yarn test <file-path>`: Run specific test file (not configured yet)
- `yarn lint`: Run linting (not configured yet)

## Code Style Guidelines
- **TypeScript**: Use strict typing with `strictNullChecks` enabled
- **Formatting**: Use 2-space indentation
- **Imports**: Group imports by type (external, internal, relative)
- **Naming**: Use camelCase for variables/functions, PascalCase for classes/interfaces
- **Routes**: Follow RESTful API patterns
- **Error Handling**: Use try/catch blocks for async operations
- **File Structure**: Follow Medusa plugin architecture with src/ directory organization
- **Framework**: Build using Medusa v2 framework components
- **React**: Use functional components with hooks for admin UI
- **Module Structure**: Follow Medusa module pattern for extension points

## Directory Structure
Maintain separation between admin UI, API routes, providers, and modules.