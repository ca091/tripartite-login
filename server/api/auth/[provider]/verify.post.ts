import { authProvider } from '../../../utils/auth'
import google from '../../../providers/google'
import apple from '../../../providers/apple'
import github from '../../../providers/github'

const adapters = { google, apple, github }

export default defineEventHandler(event => adapters[authProvider(getRouterParam(event, 'provider'))](event))
