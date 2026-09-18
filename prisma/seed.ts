import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma-client/client.js";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL must be set to run the seed script");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const CATEGORIES = [
  { slug: "technology", name: "Technology" },
  { slug: "business", name: "Business" },
  { slug: "finance", name: "Finance & Investing" },
  { slug: "economy", name: "Economy" },
  { slug: "startups", name: "Startups & Entrepreneurship" },
  { slug: "science", name: "Science" },
  { slug: "health", name: "Health & Wellness" },
  { slug: "fitness", name: "Fitness & Exercise" },
  { slug: "nutrition", name: "Food & Nutrition" },
  { slug: "lifestyle", name: "Lifestyle" },
  { slug: "fashion", name: "Fashion & Beauty" },
  { slug: "travel", name: "Travel" },
  { slug: "food", name: "Food & Cooking" },
  { slug: "home-garden", name: "Home & Garden" },
  { slug: "parenting", name: "Parenting & Family" },
  { slug: "education", name: "Education" },
  { slug: "career", name: "Career & Jobs" },
  { slug: "personal-development", name: "Personal Development" },
  { slug: "relationships", name: "Relationships" },
  { slug: "entertainment", name: "Entertainment" },
  { slug: "movies", name: "Movies & TV" },
  { slug: "music", name: "Music" },
  { slug: "books", name: "Books & Literature" },
  { slug: "arts-culture", name: "Arts & Culture" },
  { slug: "gaming", name: "Gaming" },
  { slug: "sports", name: "Sports" },
  { slug: "automotive", name: "Automotive" },
  { slug: "real-estate", name: "Real Estate" },
  { slug: "politics", name: "Politics" },
  { slug: "society", name: "Society" },
  { slug: "world", name: "World" },
  { slug: "local", name: "Local" },
  { slug: "environment", name: "Environment & Climate" },
  { slug: "sustainability", name: "Sustainability" },
  { slug: "law", name: "Law & Legal" },
  { slug: "government", name: "Government & Public Policy" },
  { slug: "religion", name: "Religion & Spirituality" },
  { slug: "history", name: "History" },
  { slug: "opinion", name: "Opinion & Editorial" },
  { slug: "news", name: "News" },
  { slug: "how-to", name: "How-To & Guides" },
  { slug: "reviews", name: "Reviews" },
  { slug: "tutorials", name: "Tutorials" },
  { slug: "productivity", name: "Productivity" },
  { slug: "marketing", name: "Marketing" },
  { slug: "design", name: "Design" },
  { slug: "programming", name: "Programming & Development" },
  { slug: "artificial-intelligence", name: "Artificial Intelligence" },
  { slug: "cybersecurity", name: "Cybersecurity" },
  { slug: "gadgets", name: "Gadgets & Electronics" },
  { slug: "cryptocurrency", name: "Cryptocurrency & Web3" },
  { slug: "data", name: "Data & Analytics" },
  { slug: "photography", name: "Photography" },
  { slug: "podcasts", name: "Podcasts" },
  { slug: "creator-economy", name: "Creator Economy" },
  { slug: "social-media", name: "Social Media" },
  { slug: "pets", name: "Pets & Animals" },
  { slug: "outdoors", name: "Outdoors & Adventure" },
  { slug: "automotive", name: "Automotive" },
  { slug: "spirituality", name: "Spirituality & Mindfulness" },
  { slug: "culture", name: "Culture" },
  { slug: "humor", name: "Humor & Memes" },
  { slug: "stories", name: "Stories" },
  { slug: "interviews", name: "Interviews" },
  { slug: "other", name: "Other" },
];

const main = async () => {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
    console.log(`Seeded category: ${category.slug}`);
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
