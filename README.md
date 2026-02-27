# LLM GM

A comprehensive world-building and session management platform built with Next.js, Supabase, and modern web technologies.

## Features

- **World Building**: Create and manage AI-powered worlds with canon entities (NPCs, items, abilities, locations, organizations, taxonomies, rules, story nodes)
- **Session Management**: Run interactive sessions within your worlds with dynamic player tracking
- **RAG-Powered Context**: Intelligent retrieval of relevant game entities using vector similarity search (reduces context size by ~75%)
- **Authentication**: Secure authentication with Supabase (Email/Password and Google OAuth)
- **Real-time Chat**: Live session chat with real-time updates
- **Dynamic Player Fields**: Customizable player attributes per world
- **Beautiful UI**: Modern, animated interface with Framer Motion and shadcn/ui

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL with pgvector, ltree)
- **AI/LLM**: OpenAI GPT-4 + text-embedding-ada-002
- **RAG**: Vector similarity search with pgvector (IVFFlat indexing)
- **Authentication**: Supabase Auth
- **UI Components**: shadcn/ui
- **Styling**: Tailwind CSS v4
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd llm-gm
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` and add your credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # For batch scripts
OPENAI_API_KEY=sk-...  # For RAG embeddings and AI generation
```

4. Run database migrations:

Go to your Supabase project dashboard → SQL Editor and run each migration file in the `migrations/` folder in numerical order (001 through 022).

**Important migrations:**
- `021_storage_setup.sql` - Storage bucket for image uploads
- `022_rag_vector_search.sql` - RAG vector search functions (**required for RAG to work**)

Alternatively, if you have Supabase CLI installed:
```bash
for file in migrations/*.sql; do
  supabase db execute -f "$file"
done
```

5. Start the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
llm-gm/
├── app/                    # Next.js app router pages
│   ├── auth/              # Authentication pages
│   ├── browse/            # Browse worlds page
│   ├── manage/            # Manage worlds pages
│   ├── sessions/          # Session management pages
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Landing page
├── components/            # React components
│   ├── layout/           # Layout components (Navbar, etc.)
│   └── ui/               # shadcn/ui components
├── contexts/             # React contexts (Auth)
├── lib/                  # Utility libraries
│   ├── supabase/        # Supabase client setup
│   ├── database.types.ts # Database types
│   └── utils.ts         # Utility functions
├── migrations/          # Database migration files
└── public/             # Static assets
```

## Database Schema

### Canon Tables (World-scoped)
- `worlds` - World definitions
- `abilities` - Character abilities
- `items` - Items and equipment
- `organizations` - Factions and groups
- `taxonomies` - Classification systems
- `locations` - Hierarchical locations (using ltree)
- `npcs` - Non-player characters
- `rules` - World rules and mechanics
- `story_nodes` - Story progression nodes
- `story_edges` - Story connections
- `world_player_fields` - Custom player field definitions

### Runtime Tables (Session-scoped)
- `sessions` - Game sessions
- `players` - Player characters
- `generated_items` - Session-specific items
- `generated_characters` - Session-specific NPCs
- `generated_locations` - Session-specific locations
- `generated_abilities` - Session-specific abilities
- `session_messages` - Chat messages
- `session_canon_state` - Session-specific state overrides

## Key Features

### Authentication
- Email/Password authentication
- Google OAuth
- Protected routes with middleware
- Persistent sessions

### World Management
- Create and edit worlds
- Define NPCs, items, abilities, locations, and more
- Tabbed editor interface
- Auto-save functionality
- Image upload support

### Session Management
- Browse and start sessions from existing worlds
- Dynamic player creation with custom fields
- Real-time chat interface
- Player state tracking
- Session history

### Design System
- Custom dark theme with cyan/violet/amber accents
- Consistent spacing and typography
- Smooth animations and transitions
- Responsive design
- Accessibility-friendly

## Development

### Running Tests
```bash
npm test
```

### Building for Production
```bash
npm run build
npm start
```

### Environment Variables

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `OPENAI_API_KEY` - Your OpenAI API key (for embeddings and AI generation)
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (for batch embedding scripts)

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## RAG System

This project implements a **Retrieval-Augmented Generation (RAG)** system for intelligent context selection:

- **Vector Embeddings**: Each game entity (item, NPC, location, etc.) has a 1536-dimensional embedding
- **Semantic Search**: Uses pgvector with IVFFlat indexing for fast similarity search
- **Smart Context**: Only retrieves top 3-5 most relevant entities per category (vs. all entities)
- **Cost Reduction**: Reduces LLM context size by ~75%, significantly lowering API costs
- **Auto-Generation**: Embeddings are automatically generated when creating/editing entities

For detailed RAG implementation guide, see [RAG_IMPLEMENTATION.md](RAG_IMPLEMENTATION.md).

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Powered by [Supabase](https://supabase.com/)
- AI by [OpenAI](https://openai.com/)
- Vector search with [pgvector](https://github.com/pgvector/pgvector)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Animations with [Framer Motion](https://www.framer.com/motion/)
