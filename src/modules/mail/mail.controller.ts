import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { EmailDto } from './dto/email.dto';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';

@ApiTags('Email')
@Controller('email')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test email',
    description: 'Sends a simple test email to verify email functionality',
  })
  @ApiBody({
    type: EmailDto,
    description: 'Email address to send test email to',
    examples: {
      example: {
        value: { email: 'jane.doe@example.com' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Test email sent successfully',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to send test email',
  })
  @ResponseMessage('Test email sent successfully')
  async sendTestEmail(@Body() body: EmailDto) {
    const sent = await this.mailService.sendOtpEmail(body.email, '222222');
    if (!sent) {
      throw new InternalServerErrorException('Failed to send test email');
    }
    return { email: body.email };
  }
}
