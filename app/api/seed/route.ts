import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Create users table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Check if dummy user exists
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, ['admin@ceisacare.com']);
    if (rows.length === 0) {
      // Hash password 'password123'
      const hashedPassword = await bcrypt.hash('password123', 10);
      await pool.query(`
        INSERT INTO users (name, email, password)
        VALUES ($1, $2, $3)
      `, ['Admin', 'admin@ceisacare.com', hashedPassword]);
      
      return NextResponse.json({ message: "Table created and dummy user seeded successfully (admin@ceisacare.com / password123)" });
    }

    return NextResponse.json({ message: "Table exists and dummy user already seeded" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
