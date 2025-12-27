import { Router } from 'express';
import { getEmergencyContacts, addEmergencyContact, removeEmergencyContact } from '../controllers/emergency.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/contacts', getEmergencyContacts);
router.post('/contacts/add', addEmergencyContact);
router.delete('/contacts/:contactUserId', removeEmergencyContact);

export default router;

