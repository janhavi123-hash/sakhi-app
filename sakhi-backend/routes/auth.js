const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    // Check if user exists
    const existing = await User.findOne({ phone });
    if (existing) return res.status(400).json({ message: 'Phone already registered' });

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({ name, phone, password: hashed });

    // Create token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: user._id, name: user.name, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ phone });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Wrong password' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: user._id, name: user.name, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;