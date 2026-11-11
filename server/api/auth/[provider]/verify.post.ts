import { authProvider } from '../../../utils/auth'
import google from '../../../providers/google'
import apple from '../../../providers/apple'
import github from '../../../providers/github'
import microsoft from '../../../providers/microsoft'

const adapters = { google, apple, github, microsoft }

export default defineEventHandler(event => adapters[authProvider(getRouterParam(event, 'provider'))](event))
