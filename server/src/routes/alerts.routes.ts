import { Router } from 'express';
import { getAlertsInbox, acknowledgeAlert } from '../controllers/alerts.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/inbox', getAlertsInbox);
router.post('/:alertId/ack', acknowledgeAlert);

export default router;





