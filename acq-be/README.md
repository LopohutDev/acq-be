# Acqua Park Me - Backend API

NestJS backend API for the Acqua Park Me smart parking marketplace.

## Tech Stack

- **Framework:** NestJS 11
- **Language:** TypeScript
- **Database:** PostgreSQL 16
- **ORM:** Prisma
- **Validation:** class-validator, class-transformer

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file:
```bash
cp .env.example .env
```

## Database Setup

From the project root directory:
```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Run Prisma migrations
cd acq-be
npx prisma migrate dev

# Generate Prisma Client (if needed)
npx prisma generate
```

## Running the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

API available at `http://localhost:3000`

## API Endpoints

- `GET /health` - Health check
- `GET /users` - Get all users
- `GET /users/:id` - Get user by ID
- `POST /users` - Create user
- `PATCH /users/:id` - Update user
- `DELETE /users/:id` - Delete user

## License

Private - All rights reserved
