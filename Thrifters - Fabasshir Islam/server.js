import express from 'express';
import session from 'express-session';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import fetch from 'node-fetch';

dotenv.config();

const app = express();

// === CONFIG ===

const STUDENT_ID = 'M01043814';

// MongoDB connection string
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = 'thrifters_db';

// File upload location
const uploadFolder = path.join(process.cwd(), 'uploads');

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },
    filename: function (req, file, cb) {
        // simple unique file name
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, STUDENT_ID + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.json()); // parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // for form-data (uploads)
app.use(
    session({
        secret: 'thrifters_secret-key',
        resave: false,
        saveUninitialized: false,
    })
);

// Serve static files from /public and /uploads
app.use(express.static('public'));
app.use(`/${STUDENT_ID}`, express.static('public'));
app.use(`/uploads/${STUDENT_ID}`, express.static('uploads'));


// -----Database Setup-----------
let db, usersCollection, itemsCollection, followsCollection;

async function start() {
    try {
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        itemsCollection = db.collection('items');
        followsCollection = db.collection('follows');

        console.log('Connected to MongoDB');

        // Start server After DB connection
        const PORT = 8080;
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}/${STUDENT_ID}/`);
        });
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}


// --------Helper: Auth Check---------
function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Not logged in' });
    }
    next();
}

// -----------------Routes-----------------------

// ---------------Register user------------------
app.post(`/${STUDENT_ID}/users`, async (req, res) => {
    try {
        const { username, email, password, location, bio } = req.body;

        // Basic validation
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username, email and password are required'
            });
        }

        // Check if username or email already exists
        const existingUser = await usersCollection.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Username or email already in use.'
            });
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user document
        const newUser = {
            username,
            email,
            passwordHash,
            location: location || '',
            bio: bio || '',
            profileImage: '',
            createdAt: new Date()
        };

        // Insert into MongoDB
        const result = await usersCollection.insertOne(newUser);

        // Auto-login the user after registration
        req.session.userId = result.insertedId.toString();

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            userId: result.insertedId.toString(),
            username: newUser.username
        });

    } catch (err) {
        console.error('Error in /users register route:', err);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
});

// -------------------------- Search users -----------------------
app.get(`/${STUDENT_ID}/users`, async (req, res) => {
    try {
        const q = req.query.q || '';
        const regex = new RegExp(q, 'i');

        const users = await usersCollection.find({ username: regex },
            {
                projection: {
                    passwordHash: 0, // never send hash
                },
            }
        ).sort({ username: 1 }).toArray();

        res.json({ success: true, users });
    } catch (err) {
        console.error("Error in GET /users:", err);
        res.status(500).json({
            success: false,
            message: "Server error while searching users",
        });
    }
});


// ----------------------- Login --------------------------------
app.post(`/${STUDENT_ID}/login`, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Basic validation
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }

        // Find user by username
        const user = await usersCollection.findOne({ username });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        // Compare password with hashed password
        const match = await bcrypt.compare(password, user.passwordHash);

        if (!match) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        // Save user id in session
        req.session.userId = user._id.toString();

        res.json({
            success: true,
            message: 'Login successful',
            username: user.username
        });
    } catch (err) {
        console.error("Error in /login route:", err);
        res.status(500).json({
            success: false,
            message: "Server error during login"
        });
    }
});

// ------------------- Check Login status -----------------------------
app.get(`/${STUDENT_ID}/login`, (req, res) => {
    if (req.session.userId) {
        return res.json({ loggedIn: true, userId: req.session.userId });
    }
    res.json({ loggedIn: false });
});

// ---------------------- Logout --------------------------------
app.delete(`/${STUDENT_ID}/login`, (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Logged out' });
    });
});

// -------------------------- Profile + Stat -----------------------------
app.get(`/${STUDENT_ID}/me`, requireLogin, async (req, res) => {
    try {
        const userId = new ObjectId(req.session.userId);

        const user = await usersCollection.findOne(
            { _id: userId },
            { projection: { passwordHash: 0 } }
        );

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const [itemsCount, followingCount, followersCount] = await Promise.all([
            itemsCollection.countDocuments({ ownerId: userId }),
            followsCollection.countDocuments({ followerId: userId }),
            followsCollection.countDocuments({ followedId: userId }),
        ]);

        res.json({
            success: true,
            user,
            stats: {
                itemsCount, followingCount, followersCount,
            },
        });
    } catch (err) {
        console.error('GET /me error', err);
        res.status(500).json({ success: false, message: "Server error fetching profile." });
    }
});

// ----------------------- Create Items --------------------------
app.post(`/${STUDENT_ID}/contents`, requireLogin, async (req, res) => {
    try {
        const {
            title,
            description,
            category,
            condition,
            priceType,
            price,
            image,
            itemKind,
            colorHex,
        } = req.body;

        // Basic validation
        if (!title || !description) {
            return res.status(400).json({
                success: false,
                message: 'Title and description are required'
            });
        }

        // Build item document
        const newItem = {
            ownerId: new ObjectId(req.session.userId),
            title,
            description,
            category: category || 'other',
            condition: condition || 'used',
            priceType: priceType || 'free', // 'free' | 'sale' | 'swap'
            price: priceType === 'sale' ? Number(price) || 0 : 0,
            image: image || '',
            status: 'available',
            itemKind: itemKind || 'other',
            colorHex: (colorHex || '').toUpperCase(),
            createdAt: new Date()
        };

        const result = await itemsCollection.insertOne(newItem);

        res.status(201).json({
            success: true,
            message: 'Item created successfully',
            itemId: result.insertedId.toString()
        });
    } catch (err) {
        console.error("Error in POST /contents:", err);
        res.status(500).json({
            success: false,
            message: "Server error while creating item"
        });
    }
});


// ------------------------- Search items -------------------------------
app.get(`/${STUDENT_ID}/contents`, async (req, res) => {
    try {
        const q = req.query.q || '';

        let filter = {};
        if (q) {
            const regex = new RegExp(q, 'i'); // search is case-insensitive
            filter = {
                $or: [
                    { title: regex },
                    { description: regex },
                    { category: regex }
                ]
            };
        }

        // Only show items that are not sold out
        filter.status = { $ne: 'sold out' };

        const items = await itemsCollection
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            success: true,
            items
        });
    } catch (err) {
        console.error("Error in GET /contents:", err);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching items'
        });
    }
});

// ------------------------ Follow -------------------------------
app.post(`/${STUDENT_ID}/follow`, requireLogin, async (req, res) => {
    try {
        const { targetUserId } = req.body;

        if (!targetUserId) {
            return res.status(400).json({
                success: false,
                message: 'targetUserId is required'
            });
        }

        const followerId = new ObjectId(req.session.userId);
        const followedId = new ObjectId(targetUserId);

        // Prevent following yourself
        if (followerId.equals(followedId)) {
            return res.status(400).json({
                success: false,
                message: 'You cannot follow yourself'
            });
        }

        // Check if target user exists
        const targetUser = await usersCollection.findOne({ _id: followedId });
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'User to follow not found'
            });
        }

        // Check if already following
        const existing = await followsCollection.findOne({
            followerId,
            followedId
        });

        if (existing) {
            return res.status(200).json({
                success: true,
                message: 'You are already following this user'
            });
        }

        // Insert follow document
        await followsCollection.insertOne({
            followerId,
            followedId,
            createdAt: new Date()
        });

        res.json({
            success: true,
            message: `Now following ${targetUser.username}`
        });
    } catch (err) {
        console.error("Error in POST /follow:", err);
        res.status(500).json({
            success: false,
            message: "Server error while following user"
        });
    }
});


// ------------------------------- Unfollow -----------------------
app.delete(`/${STUDENT_ID}/follow`, requireLogin, async (req, res) => {
    try {
        const { targetUserId } = req.body;

        if (!targetUserId) {
            return res.status(400).json({
                success: false,
                message: 'targetUserId is required'
            });
        }

        const followerId = new ObjectId(req.session.userId);
        const followedId = new ObjectId(targetUserId);

        const result = await followsCollection.deleteOne({
            followerId,
            followedId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'You were not following this user'
            });
        }

        res.json({
            success: true,
            message: "Unfollowed user successfully"
        });
    } catch (err) {
        console.error("Error in DELETE /follow:", err);
        res.status(500).json({
            success: false,
            message: "Server error while unfollowing user"
        });
    }
});


// --------------------- Feed: items from users you follow -----------
app.get(`/${STUDENT_ID}/feed`, requireLogin, async (req, res) => {
    try {
        const currentUserId = new ObjectId(req.session.userId);

        // Get all users that current user follows
        const follows = await followsCollection
            .find({ followerId: currentUserId })
            .toArray();

        const followedIds = follows.map(f => f.followedId);

        let items;
        if (followedIds.length === 0) {
            // No followed users, so return all items in the database
            items = await itemsCollection
                .find({
                    ownerId: { $ne: currentUserId }, // Exclude the current user 
                    status: { $ne: "sold out" }
                })
                .sort({ createdAt: -1 })
                .toArray();
        } else {
            // Return items for users they are following
            items = await itemsCollection
                .find({
                    ownerId: { $in: followedIds },
                    status: { $ne: 'sold out' }
                })
                .sort({ createdAt: -1 })
                .toArray();
        }
        // Attach basic owner info (username)
        const ownerIds = [...new Set(items.map(i => i.ownerId.toString()))]
            .map(id => new ObjectId(id));

        const owners = await usersCollection
            .find({ _id: { $in: ownerIds } })
            .toArray();

        const ownerMap = {};
        owners.forEach(u => {
            ownerMap[u._id.toString()] = {
                username: u.username,
                location: u.location || ''
            };
        });

        const feed = items.map(item => {
            const ownerInfo = ownerMap[item.ownerId.toString()] || {};
            return {
                ...item,
                ownerUsername: ownerInfo.username || 'Unknown',
                ownerLocation: ownerInfo.location || ''
            };
        });

        res.json({
            success: true,
            feed
        });
    } catch (err) {
        console.error('Error in GET /feed:', err);
        res.status(500).json({
            success: false,
            message: 'Server error while loading feed'
        });
    }
});


// -------------------------- Purchase List --------
app.get(`/${STUDENT_ID}/purchased`, requireLogin, async (req, res) => {
    try {
        const userId = new ObjectId(req.session.userId);

        // Fetch items where the current user is the 'purchasedBy' field
        const purchasedItems = await itemsCollection
            .find({ purchasedBy: userId })
            .sort({ createdAt: -1 }) // sort by most recent purchase
            .toArray();

        res.json({
            success: true,
            items: purchasedItems,
        });
    } catch (err) {
        console.error("Error in /purchased route:", err);
        res.status(500).json({
            success: false,
            message: "Server error while fetching purchased items",
        });
    }
});

// Mark an item as purchased
app.post(`/${STUDENT_ID}/contents/:id/purchase`, requireLogin, async (req, res) => {
    try {
        const itemId = req.params.id;
        const userId = new ObjectId(req.session.userId); // Get the logged in userId
        const { address, cardNumber } = req.body;

        // Validate the address and card number
        if (!address || !cardNumber) {
            return res.status(400).json({ success: false, message: "Address and card number are required." });
        }

        // Check if the item exists
        const item = await itemsCollection.findOne({ _id: new ObjectId(itemId) });
        if (!item) {
            return res.status(404).json({ success: false, message: "Item not found." });
        }

        // Check if the item is already purchased
        if (item.purchasedBy) {
            return res.status(400).json({ success: false, message: "This item is sold out." });
        }

        // Mark the item as purchased by the current user
        const updatedItem = await itemsCollection.updateOne(
            { _id: new ObjectId(itemId) },
            { $set: { purchasedBy: userId, status: "sold out" } }
        );

        if (updatedItem.modifiedCount === 0) {
            return res.status(500).json({ success: false, message: "Failed to purchase item." });
        }

        res.json({ success: true, message: "Item purchased successfully." });
    } catch (err) {
        console.error("Error in /contents/:id/purchase:", err);
        res.status(500).json({ success: false, message: "Server error while purchasing item." });
    }
});


// Seller's profile page should show the buyer's addess and payment statud
app.get(`/${STUDENT_ID}/me/items`, requireLogin, async (req, res) => {
    try {
        const userId = new ObjectId(req.session.userId);

        // Get items posted by the current user
        const items = await itemsCollection.find({ ownerId: userId }).toArray();

        // Add buyer's address and payment status to the item data for purchased items
        const itemsWithAddress = items.map(item => {
            if (item.purchasedBy) {
                item.buyerAddress = item.address; // Add address field to the item
                item.paymentStatus = "Paid"; // Mark the payment as successful
            }
            return item;
        });

        res.json({
            success: true,
            items: itemsWithAddress
        });
    } catch (err) {
        console.error("Error fetching seller items with address:", err);
        res.status(500).json({ success: false, message: "Failed to fetch items." });
    }
});


// ------------------------- Color-based recommendations ----------------
app.get(`/${STUDENT_ID}/contents/:id/recommendations`, requireLogin, async (req, res) => {
    try {
        const itemId = req.params.id;
        const baseItem = await itemsCollection.findOne({ _id: new ObjectId(itemId) });

        if (!baseItem) {
            return res.status(404).json({ success: false, message: "Item not found" });
        }

        // We need a color to call the color API
        if (!baseItem.colorHex) {
            return res.json({
                success: true,
                message: "No color stored for this item, so recommendations are not available",
                items: []
            });
        }

        // What kind of items should be recommended based on the clicked item
        // top -> bottoms + footwear + accessories
        // bottom -> tops + footwear
        // accessory -> tops + footwear
        // footwear -> tops + bottoms
        let targetKinds = [];
        switch (baseItem.itemKind) {
            case 'top':
                targetKinds = ['bottom', 'footwear', 'accessory'];
                break;
            case 'bottom':
            case 'accessory':
                targetKinds = ['top', 'footwear'];
                break;
            case 'footwear':
                targetKinds = ['top', 'bottom'];
                break;
            default:
                // If kind is unknown, no recommendations
                return res.json({
                    success: true,
                    message: 'No recommendations defined for this type of item',
                    items: []
                });
        }

        // Call the Color API to get a matching color scheme
        const hex = baseItem.colorHex.replace('#', '');
        const apiUrl = `https://www.thecolorapi.com/scheme?hex=${hex}&mode=analogic&count=4`;

        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Color API error: ${response.status}`);
        }

        const colorData = await response.json();
        const schemeHexes = (colorData.colors || []).map((c) =>
            c?.hex?.value?.toUpperCase()
        );

        // Find matching items from Other Users, with itemKind in targetKinds and color in scheme
        const matchingItems = await itemsCollection
            .find({
                ownerId: { $ne: baseItem.ownerId }, // other users' items
                itemKind: { $in: targetKinds },
                colorHex: { $in: schemeHexes },
                status: { $ne: 'sold out' },
            }).sort({ createdAt: -1 })
            .limit(12)
            .toArray();

        res.json({
            success: true,
            baseColor: baseItem.colorHex,
            schemeColors: schemeHexes,
            targetKinds,
            items: matchingItems,
        });
    } catch (err) {
        console.error("Error in /contents/:id/recommendations", err);
        res.status(500).json({
            success: false,
            message: "Server error while generating recommendations.",
        });
    }
});


// ------------------------------- Image Upload ---------------------
app.post(`/${STUDENT_ID}/upload/item`, requireLogin, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const imagePath = `/uploads/${STUDENT_ID}/${req.file.filename}`;
    res.json({ success: true, imagePath });
});


// Start
start();