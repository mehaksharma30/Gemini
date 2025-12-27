import { Router } from 'express';
import { createRating, getRatingStatus, deleteRating } from '../controllers/chatRating.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/', createRating);
router.get('/status', getRatingStatus);
router.delete('/:conversationId', deleteRating);

export default router;
