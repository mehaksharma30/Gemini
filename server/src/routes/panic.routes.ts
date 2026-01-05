import { Router } from 'express';
import { triggerPanic, getIncident } from '../controllers/panic.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/trigger', triggerPanic);
router.get('/incidents/:incidentId', getIncident);

export default router;






